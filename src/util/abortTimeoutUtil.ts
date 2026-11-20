import { FailedCode } from "../constants";


/**
 * 订阅中止信号：统一处理「信号已中断」与「信号随后中断」两种时机。
 * - 信号已中断（addEventListener 对已中断信号不会再触发）：立即同步执行 handler；
 * - 否则挂监听，中断时执行 handler。
 * 返回取消订阅函数（信号已中断时返回空操作，避免重复执行）。
 * 由于「检查 aborted」与「挂监听」之间无异步间隙，不会重复触发。
 */
function onSignalAbort(signal: AbortSignal | undefined, handler: () => void): () => void {
    if (!signal) return () => {};
    if (signal.aborted) { handler(); return () => {}; }
    signal.addEventListener("abort", handler);
    return () => signal.removeEventListener("abort", handler);
}


/**
 * 对单个异步等待施加「空闲超时」：任务在 timeoutMs 内未完成则触发 onTimeout 并 reject，
 * 任务先完成则正常返回。每次调用都会新建计时（idle 语义，适合流式读循环里对每次 read() 的等待）。
 * timeoutMs <= 0 表示不设限。
 */
function raceWithTimeout<T>(task: Promise<T>, timeoutMs: number, onTimeout: () => void): Promise<T> {
    if (timeoutMs <= 0) return task;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutReject = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { onTimeout(); reject(new Error("wait timed out")); }, timeoutMs);
    });
    return Promise.race([task, timeoutReject]).finally(() => clearTimeout(timer));
}


/**
 * 以文本形式读取响应体，受中止信号控制。
 * 持有 reader 才能取消已锁定的 body；Response.text() 后再 body.cancel() 会取消失败。
 */
async function readTextWithSignal(res: Response, signal: AbortSignal): Promise<string> {
    if (!res.body) {
        if (signal.aborted) throw new Error("upstream response body aborted");
        return res.text();
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    async function readText(): Promise<string> {
        let text = "";
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) return text + decoder.decode();
                text += decoder.decode(value, { stream: true });
            }
        } finally {
            reader.releaseLock();
        }
    }

    return new Promise<string>((resolve, reject) => {
        const onAbort = () => {
            signal.removeEventListener("abort", onAbort);
            reader.cancel().catch(() => {});
            reject(new Error("upstream response body aborted"));
        };
        if (signal.aborted) { onAbort(); reader.releaseLock(); return; }
        signal.addEventListener("abort", onAbort);
        readText().then(
            (text) => { signal.removeEventListener("abort", onAbort); resolve(text); },
            (err) => { signal.removeEventListener("abort", onAbort); reject(err); },
        );
    });
}


class TaggedError extends Error {
    constructor(public readonly failedCode: FailedCode, message: string, cause?: unknown) {
        super(message, cause === undefined ? undefined : { cause });
        this.name = "TaggedError";
    }
}


function isTaggedError(error: unknown): error is TaggedError {
    return error instanceof TaggedError
        || (error instanceof Error && error.name === "TaggedError" && typeof (error as TaggedError).failedCode === "string");
}


function describeError(error: unknown): string {
    if (isTaggedError(error)) return error.message;
    if (!(error instanceof Error)) return String(error);
    const cause = error.cause;
    return `${error.name}: ${error.message}${cause ? `; cause: ${cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)}` : ""}`;
}


function classifyUpstreamFetchError(error: unknown): TaggedError {
    if (isTaggedError(error)) return error;
    const networkError = error instanceof Error && (
        (error instanceof TypeError && error.message === "fetch failed")
        || (error.name === "Error" && error.message === "Network connection lost.")
    );
    return new TaggedError(networkError ? FailedCode.UPSTREAM_UNREACHABLE : FailedCode.UNKNOWN, describeError(error), error);
}


/** 保留响应体读取错误类型，同时携带可读诊断与底层原因。 */
class BodyReadError extends TaggedError {
    constructor(failedCode: FailedCode, message = `upstream response body read failed: ${failedCode}`, cause?: unknown) {
        super(failedCode, message, cause);
    }
}


/**
 * 一次封装「非流式 body 读取」的三类失败兜底：
 * - 上游断开（连接中断 / 读取失败） → UPSTREAM_DISCONNECTED
 * - 超时（timeoutMs 内未读完）     → UPSTREAM_TIMEOUT
 * - 下游断开（客户端 abort）       → CLIENT_DISCONNECTED
 *
 * 内部用 TimeoutAbortController 合并「超时 + 客户端信号」，读取失败统一抛 BodyReadError
 * （e.failedCode 即原因），正常读完返回文本。timeoutMs <= 0 关闭超时；clientAbortSignal 可省略。
 */
async function readTextWithTimeoutAndAbort(
    res: Response,
    timeoutMs: number,
    clientAbortSignal?: AbortSignal,
): Promise<string> {
    const abortCtrl = new TimeoutAbortController(timeoutMs, clientAbortSignal);
    try {
        return await readTextWithSignal(res, abortCtrl.signal);
    } catch (e) {
        throw abortCtrl.getTaggedError() ?? new BodyReadError(FailedCode.UPSTREAM_DISCONNECTED, "上游连接中断（响应体读取失败）", e);
    } finally {
        abortCtrl.dispose();
    }
}


/**
 * 合并「超时」与「客户端断连」为统一 AbortSignal，并追踪中止原因，直接给出失败码。
 *
 * 用法（fetch 走 signal；读 body 走 readTextWithTimeoutAndAbort 一次性兜底）：
 *   const abort = new TimeoutAbortController(timeoutMs, c.req.raw.signal);
 *   try {
 *       await fetch(url, { signal: abort.signal });
 *       const text = await readTextWithTimeoutAndAbort(res, timeoutMs, c.req.raw.signal);
 *   } catch (e) {
 *       const code = e instanceof BodyReadError ? e.failedCode : abort.failedCode();
 *   } finally {
 *       abort.dispose();
 *   }
 *
 * 约定：
 * - timeoutMs <= 0 表示关闭固定超时（仅客户端断开可中止）。
 * - 客户端信号已中断（fetch 前就已断开）时，结果信号立即处于中止态。
 * - dispose() 幂等，可安全调用多次。
 */
class TimeoutAbortController {
    /** 传给 fetch / 读取的中止信号 */
    readonly signal: AbortSignal;

    private readonly controller = new AbortController();
    private taggedError: TaggedError | null = null;
    private readonly timer: ReturnType<typeof setTimeout> | undefined;
    private readonly unsubscribeClient: () => void;

    constructor(timeoutMs: number, clientAbortSignal?: AbortSignal) {
        this.signal = this.controller.signal;
        if (timeoutMs > 0) {
            this.timer = setTimeout(() => this.abortWith(FailedCode.UPSTREAM_TIMEOUT, `上游响应超时（等待 ${timeoutMs}ms 无响应）`), timeoutMs);
        }
        this.unsubscribeClient = onSignalAbort(clientAbortSignal, () => this.abortWith(FailedCode.CLIENT_DISCONNECTED, "客户端断开连接，网关已中止上游请求"));
    }

    private abortWith(code: FailedCode, message: string): void {
        if (this.taggedError) return;
        this.taggedError = new TaggedError(code, message);
        this.controller.abort(this.taggedError);
    }

    /** 中止原因对应的失败码；未中止返回 null（如普通网络错误）。 */
    failedCode(): FailedCode | null {
        return this.taggedError?.failedCode ?? null;
    }

    /** fetch 在 Worker 边界可能丢失错误属性；归因优先读取本地控制器，不依赖跨边界序列化。 */
    getTaggedError(): TaggedError | null {
        return this.taggedError;
    }

    /** 清理定时器与客户端断开监听（在 finally 中调用） */
    dispose(): void {
        clearTimeout(this.timer);
        this.unsubscribeClient();
    }
}


async function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>, timeoutMs: number): Promise<ReadableStreamReadResult<Uint8Array>> {
    let timedOut = false;
    try {
        return await raceWithTimeout(reader.read(), timeoutMs, () => { timedOut = true; });
    } catch (error) {
        if (timedOut) {
            reader.cancel().catch(() => {});
            throw new TaggedError(FailedCode.UPSTREAM_TIMEOUT, `上游响应超时（流式输出空闲超过 ${timeoutMs}ms）`);
        }
        throw new TaggedError(FailedCode.UPSTREAM_DISCONNECTED, "上游连接中断（流式读取失败）", error);
    }
}


export default {
    TimeoutAbortController,
    TaggedError,
    isTaggedError,
    classifyUpstreamFetchError,
    describeError,
    readChunk,
    BodyReadError,
    onSignalAbort,
    raceWithTimeout,
    readTextWithTimeoutAndAbort,
};