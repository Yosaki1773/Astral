import customError from "../../customError";
import type { AnthropicContentBlock, AnthropicRequest, ToolCallSignatureMetadata } from "./protocolTypes";
import type { ResponsesContentPart } from "./responsesTypes";


function appendAnthropicMessage(
    messages: AnthropicRequest["messages"],
    role: "user" | "assistant",
    content: string | AnthropicContentBlock[],
): void {
    const last = messages[messages.length - 1];
    if (role === "user" && last?.role === "user") {
        const previous = typeof last.content === "string" ? [{ type: "text" as const, text: last.content }] : last.content;
        const next = typeof content === "string" ? [{ type: "text" as const, text: content }] : content;
        last.content = [...previous, ...next];
        return;
    }
    messages.push({ role, content });
}


function extractResponsesText(content: string | ResponsesContentPart[], target: "Anthropic" | "OpenAI"): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    const texts: string[] = [];
    for (const part of content) {
        if (part.type === "input_text" || part.type === "output_text") {
            texts.push(part.text);
        } else if (part.type === "input_file") {
            throw new customError.AppError(`Responses input_file cannot be converted to ${target}`, 400);
        }
    }
    return texts.join("\n");
}


function anthropicImageSourceToUrl(source: AnthropicContentBlock["source"] | undefined): string {
    if (source?.type === "base64" && source.data) {
        return `data:${source.media_type || "image/png"};base64,${source.data}`;
    }
    if (source?.type === "url" && source.url) return source.url;
    throw new customError.AppError("Anthropic image block requires a valid source (base64 data or url) for protocol conversion", 400);
}


function anthropicImageSourceFromUrl(url: string): NonNullable<AnthropicContentBlock["source"]> {
    const match = url.match(/^data:([^;,]+);base64,([\s\S]+)$/);
    if (match) return { type: "base64", media_type: match[1], data: match[2] };
    if (url.startsWith("data:")) {
        throw new customError.AppError("Unsupported image data URL for protocol conversion: expected data:<mime>;base64,<data>", 400);
    }
    return { type: "url", url };
}


/** 保留已知签名承载块，不将其他供应商扩展字段无条件传入另一协议。 */
function copyToolCallSignatureMetadata(source: ToolCallSignatureMetadata): ToolCallSignatureMetadata {
    const metadata: ToolCallSignatureMetadata = {};
    if (typeof source.extra_content?.google?.thought_signature === "string") metadata.extra_content = source.extra_content;
    if (typeof source.provider_specific_fields?.thought_signature === "string") metadata.provider_specific_fields = source.provider_specific_fields;
    return metadata;
}


export default {
    copyToolCallSignatureMetadata,
    appendAnthropicMessage,
    extractResponsesText,
    anthropicImageSourceToUrl,
    anthropicImageSourceFromUrl,
};
