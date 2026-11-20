import { ApiFormat, GEMINI_THOUGHT_SIGNATURE_BYPASS, GEMINI_THOUGHT_SIGNATURE_BYPASS_BASE64, GEMINI_THOUGHT_SIGNATURE_BYPASS_VALUES, GEMINI_THOUGHT_SIGNATURE_ID_SEPARATOR } from "../../constants";


function isRejectedSignatureError(status: number, responseText: string): boolean {
    if (status !== 400) return false;

    let message: unknown;
    try {
        const json = JSON.parse(responseText);
        message = json?.error?.message ?? json?.message;
    } catch {
        message = responseText;
    }
    return typeof message === "string" && /\b(?:invalid|corrupted)[\s_]+thought[\s_]+signature\b/i.test(message);
}


function isRealSignature(signature: unknown): signature is string {
    return typeof signature === "string" && signature.length > 0 && !GEMINI_THOUGHT_SIGNATURE_BYPASS_VALUES.includes(signature);
}


function replaceEmbeddedSignature(id: unknown): string | null {
    if (typeof id !== "string") return null;
    const separator = id.indexOf(GEMINI_THOUGHT_SIGNATURE_ID_SEPARATOR);
    if (separator <= 0) return null;
    const signature = id.slice(separator + GEMINI_THOUGHT_SIGNATURE_ID_SEPARATOR.length);
    // 仅识别参考实现的标准 base64 后缀，不把任意业务 ID 当成签名。
    if (!isRealSignature(signature) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(signature)) return null;
    return id.slice(0, separator) + GEMINI_THOUGHT_SIGNATURE_ID_SEPARATOR + GEMINI_THOUGHT_SIGNATURE_BYPASS_BASE64;
}


/** 只改 Chat/Responses 的 Gemini 工具调用签名，不遍历参数、工具输出或 encrypted_content。 */
function replaceSignatures(body: string, format: ApiFormat): { body: string; replacedSignatures: number } | null {
    if (format !== ApiFormat.OPENAI && format !== ApiFormat.RESPONSES) return null;

    let json: any;
    try {
        json = JSON.parse(body);
    } catch {
        return null;
    }

    let calls: any[];
    if (format === ApiFormat.OPENAI) {
        if (!Array.isArray(json?.messages)) return null;
        calls = json.messages.filter((message: any) => message?.role === "assistant" && Array.isArray(message.tool_calls))
            .flatMap((message: any) => message.tool_calls).filter((call: any) => call?.type === "function");
    } else {
        if (!Array.isArray(json?.input)) return null;
        calls = json.input.filter((item: any) => item?.type === "function_call");
    }

    let replacedSignatures = 0;
    const idField = format === ApiFormat.OPENAI ? "id" : "call_id";
    const repairedIds = new Map<string, string>();
    for (const call of calls) {
        const google = call.extra_content?.google;
        if (isRealSignature(google?.thought_signature)) {
            google.thought_signature = GEMINI_THOUGHT_SIGNATURE_BYPASS;
            replacedSignatures++;
        }
        const providerFields = call.provider_specific_fields;
        if (isRealSignature(providerFields?.thought_signature)) {
            providerFields.thought_signature = GEMINI_THOUGHT_SIGNATURE_BYPASS_BASE64;
            replacedSignatures++;
        }
        const originalId = call[idField];
        const repairedId = replaceEmbeddedSignature(originalId);
        if (repairedId !== null) {
            repairedIds.set(originalId, repairedId);
            call[idField] = repairedId;
            replacedSignatures++;
        }
    }

    // 仅同步匹配的调用引用，保留 Responses item.id 和用户/工具内容中的同名字符串。
    if (repairedIds.size > 0) {
        const items = format === ApiFormat.OPENAI ? json.messages : json.input;
        const referenceField = format === ApiFormat.OPENAI ? "tool_call_id" : "call_id";
        for (const item of items) {
            const isToolResult = format === ApiFormat.OPENAI ? item?.role === "tool" : item?.type === "function_call_output";
            if (isToolResult && repairedIds.has(item[referenceField])) item[referenceField] = repairedIds.get(item[referenceField]);
        }
    }
    return replacedSignatures > 0 ? { body: JSON.stringify(json), replacedSignatures } : null;
}


export default {
    isRejectedSignatureError,
    replaceSignatures,
};
