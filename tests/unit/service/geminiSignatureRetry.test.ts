import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import senderService from "../../../src/service/senderService";
import recordService from "../../../src/service/recordService";
import requestActivityService from "../../../src/service/requestActivityService";
import configService from "../../../src/service/configService";
import pluginService from "../../../src/service/pluginService";
import ruleService from "../../../src/service/ruleService";
import routingService from "../../../src/service/routingService/core";
import vendorService from "../../../src/service/vendorService";
import streamLogService from "../../../src/service/streamLogService";
import userService from "../../../src/service/userService";
import { ApiFormat, ConfigKey, FailedCode } from "../../../src/constants";

vi.mock("../../../src/service/recordService", () => ({ default: {
    create: vi.fn(), update: vi.fn(), markFailed: vi.fn(), markFailedIfActive: vi.fn(), updateResponsePayload: vi.fn(),
} }));
vi.mock("../../../src/service/requestActivityService", () => ({ default: { append: vi.fn() } }));
vi.mock("../../../src/service/configService", () => ({ default: {
    isModuleBillingEnabled: vi.fn(), isUpstreamCooldownEnabled: vi.fn(), getNumber: vi.fn(),
} }));
vi.mock("../../../src/service/pluginService", () => ({ default: { applyRequestPlugins: vi.fn() } }));
vi.mock("../../../src/service/hostService", () => ({ default: { getHostKey: vi.fn(async () => "host") } }));
vi.mock("../../../src/service/fetchUtil", () => ({ default: { getDispatcher: vi.fn(async () => null) } }));
vi.mock("../../../src/service/routingService/core", () => ({ default: { selectUpstream: vi.fn() } }));
vi.mock("../../../src/service/ruleService", () => ({ default: { matchAndCheckVendor: vi.fn() } }));
vi.mock("../../../src/service/vendorService", () => ({ default: { recordCall: vi.fn() } }));
vi.mock("../../../src/service/streamLogService", () => ({ default: {
    writeRequestLog: vi.fn(), prepareStreamLog: vi.fn(async () => null), appendStreamLog: vi.fn(),
} }));
vi.mock("../../../src/service/userService", () => ({ default: { deductBalance: vi.fn() } }));

const fetchMock = vi.fn<typeof fetch>();
const signature = "foreign-backend-signature";
const dummy = "skip_thought_signature_validator";
const record = { id: 42, created_at: new Date() } as any;


function requestBody() {
    return {
        model: "gateway-alias",
        messages: [
            { role: "user", content: "Check the weather" },
            { role: "assistant", content: null, tool_calls: [{
                id: "call-weather", type: "function",
                function: { name: "weather", arguments: '{"signature":"business-signature"}' },
                extra_content: { google: { thought_signature: signature } },
            }] },
            { role: "tool", tool_call_id: "call-weather", content: "Sunny" },
        ],
    };
}


function rejected(message = "Corrupted thought signature", status = 400) {
    return new Response(JSON.stringify({ error: { message } }), {
        status, headers: { "Content-Type": "application/json" },
    });
}


function success(stream = false) {
    const response = {
        id: "chatcmpl-test", object: "chat.completion", model: "upstream-alias",
        choices: [{ index: 0, message: { role: "assistant", content: "Sunny" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
    if (!stream) return new Response(JSON.stringify(response));
    return new Response(`data: ${JSON.stringify({
        ...response, choices: [{ index: 0, delta: { content: "Sunny" }, finish_reason: "stop" }],
    })}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } });
}


function upstream(id = 1, format = ApiFormat.OPENAI) {
    return {
        hasUpstream: () => true,
        vendor: {
            id, name: `vendor-${id}`, token: "upstream-token",
            getUrlByFormat: () => `https://upstream-${id}.example/chat/completions`,
            config: { getUserAgent: () => null },
        },
        vendorModelName: "upstream-alias", upstreamFormat: format,
    } as any;
}


async function send(body: any = requestBody(), options: { failover?: boolean; format?: ApiFormat; signal?: AbortSignal; inspect?: boolean } = {}) {
    const format = options.format ?? ApiFormat.OPENAI;
    const model = {
        id: 1, name: "gateway-alias", routing_mode: "single", prices: { input: 1, output: 2 },
        hasBilling: () => true, getRoutingConfig: () => ({ failover: { enabled: options.failover ?? false } }),
    } as any;
    const app = new Hono<{ Variables: Record<string, any> }>();
    let snapshot: any;
    app.post("/llm", async c => {
        c.set("api_format", format);
        const response = await senderService.sendRequest(c, { id: 1, name: "user", balance: 1000 } as any,
            model, format, JSON.stringify(body), { inspect: options.inspect });
        snapshot = c.get("upstreamRequestSnapshot");
        return response;
    });
    app.onError((error, c) => c.json({ error: error.message }, 502));
    const response = await app.request(new Request("http://gateway.example/llm", {
        method: "POST", body: JSON.stringify(body), signal: options.signal,
    }));
    return { response, snapshot };
}


function sentBodies() {
    return fetchMock.mock.calls.map(([, options]) => JSON.parse(options!.body as string));
}


describe("Gemini rejected thought signature recovery", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.stubGlobal("fetch", fetchMock);
        vi.mocked(recordService.create).mockResolvedValue(record);
        vi.mocked(configService.isModuleBillingEnabled).mockResolvedValue(false);
        vi.mocked(configService.isUpstreamCooldownEnabled).mockResolvedValue(false);
        vi.mocked(configService.getNumber).mockResolvedValue(1000);
        vi.mocked(pluginService.applyRequestPlugins).mockImplementation(async body => body);
        vi.mocked(routingService.selectUpstream).mockResolvedValueOnce(upstream())
            .mockResolvedValue({ hasUpstream: () => false } as any);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it.each(["Corrupted thought signature", "Invalid  thought_signature"])
        ("repairs %s on the same upstream even without failover", async message => {
            fetchMock.mockResolvedValueOnce(rejected(message)).mockResolvedValueOnce(success());
            const original = requestBody();
            const before = JSON.stringify(original);
            const { response, snapshot } = await send(original, { inspect: true });
            expect(response.status).toBe(200);
            expect(fetchMock).toHaveBeenCalledTimes(2);
            expect(fetchMock.mock.calls[0][0]).toBe(fetchMock.mock.calls[1][0]);
            expect(sentBodies()[0].messages[1].tool_calls[0].extra_content.google.thought_signature).toBe(signature);
            const expected = JSON.parse(JSON.stringify(sentBodies()[0]));
            expected.messages[1].tool_calls[0].extra_content.google.thought_signature = dummy;
            expect(sentBodies()[1]).toEqual(expected);
            expect(JSON.stringify(original)).toBe(before);
            expect(snapshot.body).toBe(fetchMock.mock.calls[1][1]!.body);
            expect(recordService.create).toHaveBeenCalledOnce();
            expect(recordService.markFailed).not.toHaveBeenCalled();
            expect(recordService.update).not.toHaveBeenCalledWith(42, expect.objectContaining({ status: "failed" }));
            expect(userService.deductBalance).toHaveBeenCalledOnce();
            expect(vendorService.recordCall).toHaveBeenCalledTimes(2);
            expect(streamLogService.writeRequestLog).toHaveBeenCalledTimes(2);
            expect(pluginService.applyRequestPlugins).toHaveBeenCalledOnce();
            expect(routingService.selectUpstream).toHaveBeenCalledOnce();
            expect(requestActivityService.append).toHaveBeenCalledWith(42, "upstream_attempt", expect.any(String),
                expect.objectContaining({ upstream_status: 400, replaced_signatures: 1 }), "warn");
        });

    it.each([
        [ApiFormat.RESPONSES, "extra"], [ApiFormat.RESPONSES, "provider"], [ApiFormat.RESPONSES, "embedded"],
        [ApiFormat.OPENAI, "extra"], [ApiFormat.OPENAI, "provider"], [ApiFormat.OPENAI, "embedded"],
    ] as const)("repairs Responses input sent to %s with %s signatures", async (upstreamFormat, encoding) => {
        const call: any = { type: "function_call", id: "fc-keep", call_id: "call-weather", name: "weather", arguments: '{"signature":"business-keep"}' };
        if (encoding === "extra") call.extra_content = { google: { thought_signature: signature } };
        if (encoding === "provider") call.provider_specific_fields = { thought_signature: btoa(signature) };
        if (encoding === "embedded") call.call_id += `__thought__${btoa(signature)}`;
        const body = { model: "gateway-alias", input: [
            { type: "message", role: "user", content: "Weather?" }, call,
            { type: "function_call_output", call_id: call.call_id, output: "Sunny" },
        ] };
        const original = JSON.stringify(body);
        vi.mocked(routingService.selectUpstream).mockReset().mockResolvedValueOnce(upstream(1, upstreamFormat));
        const accepted = upstreamFormat === ApiFormat.RESPONSES ? new Response(JSON.stringify({
            id: "resp-test", object: "response", status: "completed", model: "upstream-alias", output: [],
            usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        })) : success();
        fetchMock.mockResolvedValueOnce(rejected()).mockResolvedValueOnce(accepted);
        const { response } = await send(body, { format: ApiFormat.RESPONSES });
        expect(response.status).toBe(200);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        const sent = sentBodies();
        const firstCall = upstreamFormat === ApiFormat.RESPONSES ? sent[0].input[1] : sent[0].messages[1].tool_calls[0];
        const repairedCall = upstreamFormat === ApiFormat.RESPONSES ? sent[1].input[1] : sent[1].messages[1].tool_calls[0];
        if (encoding === "extra") {
            expect(firstCall.extra_content.google.thought_signature).toBe(signature);
            expect(repairedCall.extra_content.google.thought_signature).toBe(dummy);
        } else if (encoding === "provider") {
            expect(firstCall.provider_specific_fields.thought_signature).toBe(btoa(signature));
            expect(repairedCall.provider_specific_fields.thought_signature).toBe(btoa(dummy));
        } else {
            const repairedId = `call-weather__thought__${btoa(dummy)}`;
            expect(repairedCall[upstreamFormat === ApiFormat.RESPONSES ? "call_id" : "id"]).toBe(repairedId);
            const output = upstreamFormat === ApiFormat.RESPONSES ? sent[1].input[2] : sent[1].messages[2];
            expect(output[upstreamFormat === ApiFormat.RESPONSES ? "call_id" : "tool_call_id"]).toBe(repairedId);
        }
        expect(JSON.stringify(body)).toBe(original);
        expect(recordService.markFailed).not.toHaveBeenCalled();
        expect(userService.deductBalance).toHaveBeenCalledOnce();
        expect(vendorService.recordCall).toHaveBeenCalledTimes(2);
        expect(pluginService.applyRequestPlugins).toHaveBeenCalledTimes(upstreamFormat === ApiFormat.RESPONSES ? 1 : 2);
    });

    it("keeps an accepted signature and makes only one call", async () => {
        fetchMock.mockResolvedValueOnce(success());
        expect((await send()).response.status).toBe(200);
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(sentBodies()[0].messages[1].tool_calls[0].extra_content.google.thought_signature).toBe(signature);
    });

    it.each(["Invalid model", ""])("preserves a nonmatching pre-read 400 body: %s", async text => {
        const raw = new Response(text, { status: 400, headers: { "Content-Type": "text/plain" } });
        const read = vi.spyOn(raw.body!, "getReader");
        fetchMock.mockResolvedValueOnce(raw);
        const { response } = await send();
        expect(response.status).toBe(400);
        expect(response.headers.get("Content-Type")).toBe("text/plain");
        expect(await response.text()).toBe(text);
        expect(read).toHaveBeenCalledOnce();
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(userService.deductBalance).not.toHaveBeenCalled();
    });

    it.each([401, 429, 500, 200])("does not recover signature errors at status %s", async status => {
        fetchMock.mockResolvedValueOnce(rejected("Invalid thought signature", status));
        expect((await send()).response.status).toBe(status);
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it.each([undefined, "", dummy, "context_engineering_is_the_way_to_go"])
        ("does not retry when the only slot is %s", async value => {
            const body = requestBody();
            body.messages[1].tool_calls![0].extra_content.google.thought_signature = value as any;
            fetchMock.mockResolvedValueOnce(rejected());
            expect((await send(body)).response.status).toBe(400);
            expect(fetchMock).toHaveBeenCalledOnce();
        });

    it("limits persistent rejection to two calls per upstream without leaking repaired history to failover", async () => {
        vi.mocked(routingService.selectUpstream).mockReset().mockResolvedValueOnce(upstream(1))
            .mockResolvedValueOnce(upstream(2)).mockResolvedValue({ hasUpstream: () => false } as any);
        fetchMock.mockImplementation(async () => rejected());
        expect((await send(requestBody(), { failover: true })).response.status).toBe(400);
        expect(fetchMock).toHaveBeenCalledTimes(4);
        expect(sentBodies().map(body => body.messages[1].tool_calls[0].extra_content.google.thought_signature))
            .toEqual([signature, dummy, signature, dummy]);
        expect(userService.deductBalance).not.toHaveBeenCalled();
    });

    it("hands the second HTTP failure to existing failover", async () => {
        vi.mocked(routingService.selectUpstream).mockReset().mockResolvedValueOnce(upstream(1))
            .mockResolvedValueOnce(upstream(2));
        fetchMock.mockResolvedValueOnce(rejected()).mockResolvedValueOnce(rejected("unavailable", 503))
            .mockResolvedValueOnce(success());
        expect((await send(requestBody(), { failover: true })).response.status).toBe(200);
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(sentBodies()[2].messages[1].tool_calls[0].extra_content.google.thought_signature).toBe(signature);
    });

    it("does not retry a second network failure", async () => {
        fetchMock.mockResolvedValueOnce(rejected()).mockRejectedValueOnce(new TypeError("fetch failed"));
        expect((await send()).response.status).toBe(502);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(recordService.markFailed).toHaveBeenCalledWith(42, FailedCode.UPSTREAM_UNREACHABLE, expect.anything());
    });

    it("recovers a streaming request before any SSE is forwarded", async () => {
        fetchMock.mockResolvedValueOnce(rejected()).mockResolvedValueOnce(success(true));
        const { response } = await send({ ...requestBody(), stream: true });
        expect(response.headers.get("Content-Type")).toContain("text/event-stream");
        expect(await response.text()).toContain("Sunny");
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(sentBodies()[1].stream_options).toEqual({ include_usage: true });
        expect(recordService.markFailed).not.toHaveBeenCalled();
    });

    it("never replays a signature error inside an established SSE response", async () => {
        fetchMock.mockResolvedValueOnce(new Response(`data: ${JSON.stringify({ error: { message: "Invalid thought signature" } })}\n\n`,
            { headers: { "Content-Type": "text/event-stream" } }));
        expect(await (await send({ ...requestBody(), stream: true })).response.text()).toContain("Invalid thought signature");
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("uses the final post-conversion plugin body without rerunning conversion or plugins", async () => {
        vi.mocked(pluginService.applyRequestPlugins).mockImplementation(async (body, format) =>
            format === ApiFormat.OPENAI ? JSON.stringify({ ...JSON.parse(body), messages: requestBody().messages }) : body);
        fetchMock.mockResolvedValueOnce(rejected()).mockResolvedValueOnce(success());
        const { response } = await send({ model: "gateway-alias", messages: [{ role: "user", content: "Weather?" }], max_tokens: 100 },
            { format: ApiFormat.ANTHROPIC });
        expect(response.status).toBe(200);
        const converted = await response.json() as { type: string };
        expect(converted.type).toBe("message");
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(pluginService.applyRequestPlugins).toHaveBeenCalledTimes(2);
        expect(ruleService.matchAndCheckVendor).toHaveBeenCalledOnce();
    });

    it("preserves body-read timeout attribution and does not resend", async () => {
        vi.mocked(configService.getNumber).mockImplementation(async key => key === ConfigKey.UPSTREAM_NON_STREAM_TIMEOUT_MS ? 10 : 1000);
        fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({ start() {} }), { status: 400 }));
        expect((await send()).response.status).toBe(502);
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(recordService.markFailed).toHaveBeenCalledWith(42, FailedCode.UPSTREAM_TIMEOUT, expect.anything());
    });

    it("preserves body disconnection attribution and does not resend", async () => {
        fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) { controller.error(new Error("connection lost")); } }),
            { status: 400 }));
        expect((await send()).response.status).toBe(502);
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(recordService.markFailed).toHaveBeenCalledWith(42, FailedCode.UPSTREAM_DISCONNECTED, expect.anything());
    });

    it("does not send again when the client aborts between recovery attempts", async () => {
        const client = new AbortController();
        vi.mocked(requestActivityService.append).mockImplementation(async (_id, _stage, _message, _details, level) => {
            if (level === "warn") client.abort();
        });
        fetchMock.mockResolvedValueOnce(rejected()).mockResolvedValueOnce(success());
        expect((await send(requestBody(), { signal: client.signal })).response.status).toBe(502);
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(recordService.markFailed).toHaveBeenCalledWith(42, FailedCode.CLIENT_DISCONNECTED, expect.anything());
    });

    it("gives the second POST its own header timeout", async () => {
        vi.mocked(configService.getNumber).mockResolvedValue(10);
        fetchMock.mockResolvedValueOnce(rejected()).mockImplementationOnce(async (_url, options) => new Promise((_resolve, reject) => {
            options!.signal!.addEventListener("abort", () => reject(options!.signal!.reason), { once: true });
        }));
        expect((await send()).response.status).toBe(502);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(recordService.markFailed).toHaveBeenCalledWith(42, FailedCode.UPSTREAM_TIMEOUT, expect.anything());
        expect(vendorService.recordCall).toHaveBeenCalledTimes(2);
    });
});
