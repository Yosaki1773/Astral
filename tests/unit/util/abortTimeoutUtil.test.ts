import { afterEach, describe, expect, it, vi } from "vitest";
import abortTimeoutUtil from "../../../src/util/abortTimeoutUtil";
import { FailedCode } from "../../../src/constants";


afterEach(() => vi.useRealTimers());


describe("upstream failure diagnostics", () => {
    it.each([new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED") }), new Error("Network connection lost.")])
        ("classifies runtime network failures without losing the cause", error => {
            const classified = abortTimeoutUtil.classifyUpstreamFetchError(error);
            expect(classified.failedCode).toBe("upstream_unreachable");
            expect(classified.cause).toBe(error);
            expect(classified.message).toContain(error.message);
        });

    it("recognizes an error whose prototype was lost across a runtime boundary", () => {
        const error = Object.assign(new Error("上游响应超时"), { name: "TaggedError", failedCode: FailedCode.UPSTREAM_TIMEOUT });
        expect(abortTimeoutUtil.isTaggedError(error)).toBe(true);
        expect(abortTimeoutUtil.classifyUpstreamFetchError(error)).toBe(error);
    });

    it("keeps non-network TypeErrors classified as internal errors", () => {
        const error = new TypeError("Invalid URL");
        expect(abortTimeoutUtil.classifyUpstreamFetchError(error).failedCode).toBe(FailedCode.UNKNOWN);
        expect(abortTimeoutUtil.describeError(new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED") })))
            .toContain("ECONNREFUSED");
    });

    it("preserves the first abort reason when a timeout is followed by client disconnect", async () => {
        vi.useFakeTimers();
        const client = new AbortController();
        const controller = new abortTimeoutUtil.TimeoutAbortController(25, client.signal);
        await vi.advanceTimersByTimeAsync(25);
        client.abort();
        expect(controller.failedCode()).toBe(FailedCode.UPSTREAM_TIMEOUT);
        expect(controller.getTaggedError()?.message).toContain("25ms");
        controller.dispose();
    });

    it("preserves a pre-aborted client reason instead of overwriting it with a timeout", async () => {
        vi.useFakeTimers();
        const client = new AbortController();
        client.abort();
        const controller = new abortTimeoutUtil.TimeoutAbortController(25, client.signal);
        await vi.advanceTimersByTimeAsync(25);
        expect(controller.failedCode()).toBe(FailedCode.CLIENT_DISCONNECTED);
        expect(controller.getTaggedError()?.message).toContain("客户端断开");
        controller.dispose();
    });

    it("records readable body-read timeout details", async () => {
        const response = new Response(new ReadableStream({ start() {} }));
        await expect(abortTimeoutUtil.readTextWithTimeoutAndAbort(response, 20))
            .rejects.toMatchObject({ failedCode: FailedCode.UPSTREAM_TIMEOUT, message: expect.stringContaining("20ms") });
    });

    it("tags idle reads and cancels the reader", async () => {
        const cancel = vi.fn().mockResolvedValue(undefined);
        const reader = { read: () => new Promise(() => {}), cancel } as unknown as ReadableStreamDefaultReader<Uint8Array>;
        await expect(abortTimeoutUtil.readChunk(reader, 20))
            .rejects.toMatchObject({ failedCode: FailedCode.UPSTREAM_TIMEOUT, message: expect.stringContaining("20ms") });
        expect(cancel).toHaveBeenCalledOnce();
    });
});
