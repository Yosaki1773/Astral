import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import responseHandlerService from "../../src/service/responseHandlerService";
import recordService from "../../src/service/recordService";
import { ApiFormat, SgRecordStatus } from "../../src/constants";
import type { SgRecord } from "../../src/model/sgRecord";
import type { SgModel } from "../../src/model/sgModel";
import type { SgUser } from "../../src/model/sgUser";

vi.mock("../../src/service/recordService", () => ({ default: {
    updateResponsePayload: vi.fn(), update: vi.fn(), markFailed: vi.fn(),
} }));
vi.mock("../../src/service/configService", () => ({ default: { getNumber: vi.fn(async () => 10000) } }));
vi.mock("../../src/service/streamLogService", () => ({ default: { prepareStreamLog: vi.fn(async () => null), appendStreamLog: vi.fn() } }));
vi.mock("../../src/service/requestActivityService", () => ({ default: { append: vi.fn(async () => {}) } }));
vi.mock("../../src/service/userService", () => ({ default: { deductBalance: vi.fn() } }));
vi.mock("../../src/util/protocol/usageUtil", () => ({ default: { normalizeUsage: vi.fn(() => null), serializeStoredUsage: vi.fn(() => null) } }));

function event(content: string, finish = false): Uint8Array {
    return new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: finish ? "stop" : null }] })}\n\n${finish ? "data: [DONE]\n\n" : ""}`);
}

async function startStream() {
    let upstream!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(controller) { upstream = controller; } });
    upstream.enqueue(event("first"));
    const app = new Hono();
    app.get("/stream", c => responseHandlerService.handleStreamResponse(c, new Response(body),
        { id: 1, created_at: new Date() } as SgRecord, {} as SgModel, { type: "root" } as SgUser, ApiFormat.OPENAI));
    const response = await app.request("/stream");
    const text = response.text();
    return { upstream, text };
}


describe("stream reply snapshot lifecycle", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.mocked(recordService.update).mockResolvedValue(1);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("awaits an in-flight snapshot before final persistence and never overlaps snapshot writes", async () => {
        let finishWrite!: () => void;
        vi.mocked(recordService.updateResponsePayload).mockImplementation(() => new Promise(resolve => { finishWrite = resolve; }));
        const { upstream, text } = await startStream();
        await vi.advanceTimersByTimeAsync(1000);
        expect(recordService.updateResponsePayload).toHaveBeenCalledTimes(1);
        upstream.enqueue(event(" second"));
        await vi.advanceTimersByTimeAsync(1000);
        expect(recordService.updateResponsePayload).toHaveBeenCalledTimes(1);
        upstream.enqueue(event("", true));
        await vi.advanceTimersByTimeAsync(0);
        expect(recordService.update).not.toHaveBeenCalled();
        finishWrite();
        expect(await text).toContain("[DONE]");
        expect(recordService.update).toHaveBeenCalledWith(1, expect.objectContaining({
            status: SgRecordStatus.SUCCESS,
            response_data: expect.stringContaining("first second"),
        }));
        expect(vi.getTimerCount()).toBe(0);
    });

    it("keeps forwarding the stream when preview persistence fails", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        vi.mocked(recordService.updateResponsePayload).mockRejectedValue(new Error("storage unavailable"));
        const { upstream, text } = await startStream();
        await vi.advanceTimersByTimeAsync(1000);
        upstream.enqueue(event(" second", true));
        expect(await text).toContain("second");
        expect(recordService.markFailed).not.toHaveBeenCalled();
        expect(recordService.update).toHaveBeenCalledWith(1, expect.objectContaining({ status: SgRecordStatus.SUCCESS }));
        expect(vi.getTimerCount()).toBe(0);
    });
});
