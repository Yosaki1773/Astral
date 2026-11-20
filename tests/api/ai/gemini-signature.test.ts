import { randomUUID } from "crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { setupAdminUser } from "../../globalSetup";
import dbHelper from "../../helpers/dbHelper";
import requestHelper from "../../helpers/requestHelper";
import mockHelper from "../../helpers/mockHelper";
import upstreamCaptureHelper from "../../helpers/upstreamCaptureHelper";
import vendorFixtures from "../../fixtures/vendorFixtures";
import config from "../../config";

let adminToken: string;
let userToken: string;
const dummy = "skip_thought_signature_validator";


async function createModel(scenarios: string[], failover = false, format: "openai" | "responses" = "openai") {
    const name = `signature-${randomUUID()}`;
    const vendors: number[] = [];
    for (const scenario of scenarios) {
        const vendor = await requestHelper.post("/vendor/create.json", {
            ...vendorFixtures.VENDOR_FIXTURES.openai(),
            urls: { [format]: `${config.UPSTREAM_CONFIG.mock.url}/${format === "responses" ? "responses" : "chat/completions"}/gemini-signature/${scenario}` },
        }, adminToken);
        expect(vendor.status).toBe(200);
        const vendorModel = await requestHelper.post(`/vendor/${vendor.body.id}/model/add.json`, { model_id: name }, adminToken);
        expect(vendorModel.status).toBe(200);
        vendors.push(vendor.body.id);
    }
    const model = await requestHelper.post("/model/create.json", {
        name, routing_mode: vendors.length === 1 ? "single" : "first_available",
        routing_config: { upstreams: vendors.map(vendor_id => ({ vendor_id, enabled: true })), failover: { enabled: failover } },
    }, adminToken);
    expect(model.status).toBe(200);
    return { ...model.body, vendors };
}


function history(model: string, signature = "foreign-A", stream = false) {
    return {
        model, stream,
        messages: [
            { role: "user", content: "Check the flight and book a taxi" },
            { role: "assistant", content: null, tool_calls: [
                { id: "call-flight", type: "function", function: { name: "flight", arguments: '{"signature":"business-value"}' },
                    extra_content: { google: { thought_signature: signature } } },
                { id: "call-taxi", type: "function", function: { name: "taxi", arguments: "{}" } },
            ] },
            { role: "tool", tool_call_id: "call-flight", content: "Delayed" },
            { role: "tool", tool_call_id: "call-taxi", content: "Booked" },
            { role: "assistant", content: null, tool_calls: [
                { id: "call-confirm", type: "function", function: { name: "confirm", arguments: "{}" },
                    extra_content: { google: { thought_signature: signature === "foreign-A" ? "foreign-B" : signature } } },
            ] },
            { role: "tool", tool_call_id: "call-confirm", content: "Confirmed" },
        ],
    };
}


function responsesHistory(model: string, encoding: "extra" | "provider" | "embedded", stream = false) {
    const input: any[] = [{ type: "message", role: "user", content: "Check the weather" }];
    const calls = ["call-A", "call-B"].map((call_id, index) => {
        const signature = `foreign-${index}`;
        const call: any = { type: "function_call", id: `fc-${index}`, call_id, name: "weather", arguments: '{"signature":"business-keep"}' };
        if (encoding === "extra") call.extra_content = { google: { thought_signature: signature } };
        if (encoding === "provider") call.provider_specific_fields = { thought_signature: btoa(signature) };
        if (encoding === "embedded") call.call_id += `__thought__${btoa(signature)}`;
        return call;
    });
    input.push(...calls, ...calls.map(call => ({ type: "function_call_output", call_id: call.call_id, output: "Sunny" })));
    return { model, stream, input };
}


async function captures(model: string) {
    return (await upstreamCaptureHelper.list()).filter(request => request.json?.model === model);
}


async function finalizedRecord(modelId: number) {
    // 流式最终写回在后台执行，先沿用 helper 等待请求收尾。
    await requestHelper.getFinalizedRecords(adminToken);
    const records = await requestHelper.get(`/record/list.json?model_ids=${modelId}`, adminToken);
    expect(records.body.total).toBe(1);
    return records.body.list[0];
}


describe("Gemini signature recovery API", { timeout: config.TEST_OPTIONS.timeout }, () => {
    beforeAll(async () => {
        await dbHelper.truncate();
        adminToken = await setupAdminUser();
        const user = await requestHelper.post("/user/create.json", mockHelper.generateUser(), adminToken);
        expect(user.status).toBe(200);
        userToken = user.body.token;
    });

    it.each(["invalid", "corrupted"])("recovers %s on a fixed supplier without enabling failover", async scenario => {
        const model = await createModel([scenario]);
        const body = history(model.name);
        const original = JSON.stringify(body);
        const response = await requestHelper.post("/llm/v1/chat/completions", body, userToken);
        expect(response.status).toBe(200);
        const requests = await captures(model.name);
        expect(requests).toHaveLength(2);
        expect(requests[0].url).toBe(requests[1].url);
        expect(requests[0].json).toEqual(body);
        const expected = JSON.parse(original);
        expected.messages[1].tool_calls[0].extra_content.google.thought_signature = dummy;
        expected.messages[4].tool_calls[0].extra_content.google.thought_signature = dummy;
        expect(requests[1].json).toEqual(expected);
        expect(JSON.stringify(body)).toBe(original);

        const record = await finalizedRecord(model.id);
        expect(record.status).toBe("success");
        expect(record.vendor_id).toBe(model.vendors[0]);
        expect(record.end_at).toBeTruthy();
        const activity = await requestHelper.get(`/record/${record.id}/activity.json`, adminToken);
        expect(activity.body.activities.map((item: any) => item.stage)).toEqual([
            "routing", "upstream_attempt", "upstream_attempt", "upstream_attempt", "result",
        ]);
        expect(activity.body.activities[2]).toMatchObject({ level: "warn", details: { replaced_signatures: 2, upstream_status: 400 } });
        expect(activity.body.activities.filter((item: any) => item.stage === "result")).toHaveLength(1);
    });

    it("preserves an accepted signature and performs a single POST", async () => {
        const model = await createModel(["corrupted"]);
        const body = history(model.name, "accepted-signature");
        expect((await requestHelper.post("/llm/v1/chat/completions", body, userToken)).status).toBe(200);
        const requests = await captures(model.name);
        expect(requests).toHaveLength(1);
        expect(requests[0].json).toEqual(body);
    });

    it("recovers a streamed request before forwarding SSE", async () => {
        const model = await createModel(["invalid"]);
        const response = await requestHelper.post("/llm/v1/chat/completions", history(model.name, "foreign-A", true), userToken);
        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Type")).toContain("text/event-stream");
        expect(response.body).toContain("[DONE]");
        const requests = await captures(model.name);
        expect(requests).toHaveLength(2);
        expect(requests[1].json.stream_options).toEqual({ include_usage: true });
        expect((await finalizedRecord(model.id)).status).toBe("success");
    });

    it("stops after the second rejection when failover is disabled", async () => {
        const model = await createModel(["always"]);
        const response = await requestHelper.post("/llm/v1/chat/completions", history(model.name), userToken);
        expect(response.status).toBe(400);
        expect(response.body.error.message).toBe("Corrupted thought signature");
        expect(await captures(model.name)).toHaveLength(2);
        expect((await finalizedRecord(model.id)).status).toBe("failed");
    });

    it("keeps each supplier's first attempt isolated from another supplier's repaired history", async () => {
        const model = await createModel(["always", "invalid"], true);
        const response = await requestHelper.post("/llm/v1/chat/completions", history(model.name), userToken);
        expect(response.status).toBe(200);
        const requests = await captures(model.name);
        expect(requests).toHaveLength(4);
        expect(requests.map(request => request.json.messages[1].tool_calls[0].extra_content.google.thought_signature))
            .toEqual(["foreign-A", dummy, "foreign-A", dummy]);
        expect((await finalizedRecord(model.id)).vendor_id).toBe(model.vendors[1]);
    });

    it("bounds total attempts when all suppliers reject placeholders", async () => {
        const model = await createModel(["always", "always"], true);
        expect((await requestHelper.post("/llm/v1/chat/completions", history(model.name), userToken)).status).toBe(400);
        expect(await captures(model.name)).toHaveLength(4);
        expect((await finalizedRecord(model.id)).status).toBe("failed");
    });

    it("does not internally retry ordinary 400 errors but retains existing failover", async () => {
        const model = await createModel(["ordinary", "invalid"], true);
        expect((await requestHelper.post("/llm/v1/chat/completions", history(model.name), userToken)).status).toBe(200);
        const requests = await captures(model.name);
        expect(requests).toHaveLength(3);
        expect(requests[0].url).toContain("ordinary");
        expect(requests[1].url).toContain("invalid");
        expect(requests[2].url).toContain("invalid");
    });

    it.each([
        ["responses", "extra"], ["responses", "provider"], ["responses", "embedded"],
        ["openai", "extra"], ["openai", "provider"], ["openai", "embedded"],
    ] as const)("recovers Responses input through %s upstream with %s signatures", async (format, encoding) => {
        const model = await createModel(["invalid"], false, format);
        const body = responsesHistory(model.name, encoding);
        const original = JSON.stringify(body);
        const response = await requestHelper.post("/llm/v1/responses", body, userToken);
        expect(response.status).toBe(200);
        expect(response.body.object).toBe("response");
        const requests = await captures(model.name);
        expect(requests).toHaveLength(2);
        const repairedCalls = format === "responses" ? requests[1].json.input.filter((item: any) => item.type === "function_call")
            : requests[1].json.messages.find((message: any) => message.role === "assistant").tool_calls;
        for (const [index, call] of repairedCalls.entries()) {
            if (encoding === "extra") expect(call.extra_content.google.thought_signature).toBe(dummy);
            if (encoding === "provider") expect(call.provider_specific_fields.thought_signature).toBe(btoa(dummy));
            if (encoding === "embedded") expect(call[format === "responses" ? "call_id" : "id"]).toBe(`call-${index === 0 ? "A" : "B"}__thought__${btoa(dummy)}`);
            expect(format === "responses" ? call.arguments : call.function.arguments).toBe('{"signature":"business-keep"}');
        }
        if (format === "responses") {
            expect(requests[0].json).toMatchObject(body);
            // 以插件后的真实请求为基线；恢复只能改签名，prompt_cache_key 等字段必须保持。
            const expected = JSON.parse(requests[0].body);
            for (const call of expected.input.filter((item: any) => item.type === "function_call")) {
                if (encoding === "extra") call.extra_content.google.thought_signature = dummy;
                if (encoding === "provider") call.provider_specific_fields.thought_signature = btoa(dummy);
                if (encoding === "embedded") {
                    const oldId = call.call_id;
                    call.call_id = oldId.split("__thought__")[0] + `__thought__${btoa(dummy)}`;
                    expected.input.find((item: any) => item.type === "function_call_output" && item.call_id === oldId).call_id = call.call_id;
                }
            }
            expect(requests[1].json).toEqual(expected);
        }
        expect(JSON.stringify(body)).toBe(original);
        expect((await finalizedRecord(model.id)).status).toBe("success");
    });

    it.each(["responses", "openai"] as const)("recovers streamed Responses input through %s upstream", async format => {
        const model = await createModel(["corrupted"], false, format);
        const response = await requestHelper.post("/llm/v1/responses", responsesHistory(model.name, "embedded", true), userToken);
        expect(response.status).toBe(200);
        expect(response.body).toContain("response.completed");
        expect(await captures(model.name)).toHaveLength(2);
        expect((await finalizedRecord(model.id)).status).toBe("success");
    });

    it("limits Responses failover to two posts per supplier and preserves original signatures for the next supplier", async () => {
        const model = await createModel(["always", "invalid"], true, "responses");
        const response = await requestHelper.post("/llm/v1/responses", responsesHistory(model.name, "embedded"), userToken);
        expect(response.status).toBe(200);
        const requests = await captures(model.name);
        expect(requests).toHaveLength(4);
        expect(requests[0].json).toEqual(requests[2].json);
        expect(requests[1].json).toEqual(requests[3].json);
        expect((await finalizedRecord(model.id)).vendor_id).toBe(model.vendors[1]);
    });

    it.each(["no-slot", "placeholder"])("does not replay a rejection with %s", async scenario => {
        const model = await createModel(["always"]);
        const body = history(model.name, dummy);
        if (scenario === "no-slot") {
            delete (body.messages[1].tool_calls![0] as any).extra_content;
            delete (body.messages[4].tool_calls![0] as any).extra_content;
        }
        expect((await requestHelper.post("/llm/v1/chat/completions", body, userToken)).status).toBe(400);
        expect(await captures(model.name)).toHaveLength(1);
    });
});
