import { describe, expect, it } from "vitest";
import { ApiFormat } from "../../../src/constants";
import { ConverterFactory } from "../../../src/util/protocolConverter/ConverterFactory";
import openaiChatAccumulator from "../../../src/util/accumulator/openaiChatAccumulator";
import anthropicAccumulator from "../../../src/util/accumulator/anthropicAccumulator";
import responsesAccumulator from "../../../src/util/accumulator/responsesAccumulator";

const imageUrl = "data:image/png;base64,aGVsbG8=";
const anthropicImage = { type: "image", source: { type: "base64", media_type: "image/png", data: "aGVsbG8=" } };

function convert(client: ApiFormat, upstream: ApiFormat, request: unknown) {
    return JSON.parse(ConverterFactory.create(client, upstream)!.convertRequestBody(JSON.stringify(request)));
}


describe("cross-protocol error regression", () => {
    it.each([
        [ApiFormat.OPENAI, ApiFormat.RESPONSES],
        [ApiFormat.ANTHROPIC, ApiFormat.RESPONSES],
        [ApiFormat.RESPONSES, ApiFormat.OPENAI],
    ])("delivers upstream errors to the %s client and accumulator from %s", (client, upstream) => {
        const converter = ConverterFactory.create(client, upstream)!;
        const payload = upstream === ApiFormat.RESPONSES
            ? { type: "response.failed", response: { error: { code: "server_error", message: "generation failed" } } }
            : { error: { code: "server_error", message: "generation failed" } };
        const events = converter.convertStreamEvent(JSON.stringify(payload));
        expect(events).toHaveLength(1);
        expect(events[0].event).toBe("error");
        expect(events[0].data).toContain("generation failed");
        const accumulator = client === ApiFormat.OPENAI
            ? new openaiChatAccumulator.OpenAIChatAccumulator()
            : client === ApiFormat.ANTHROPIC
                ? new anthropicAccumulator.AnthropicAccumulator()
                : new responsesAccumulator.ResponsesAccumulator();
        events.forEach(event => accumulator.addEvent(event));
        converter.onUpstreamEnd().forEach(event => accumulator.addEvent(event));
        accumulator.onUpstreamEnd();
        expect(accumulator.isErrored()).toBe(true);
        expect(accumulator.isCompleted()).toBe(false);
    });

    it("does not turn a finish chunk followed by an error into success at EOF", () => {
        const converter = ConverterFactory.create(ApiFormat.RESPONSES, ApiFormat.OPENAI)!;
        const accumulator = new responsesAccumulator.ResponsesAccumulator();
        for (const payload of [
            { choices: [{ index: 0, delta: { content: "partial" }, finish_reason: "stop" }] },
            { error: { message: "generation failed", code: "server_error" } },
        ]) {
            converter.convertStreamEvent(JSON.stringify(payload)).forEach(event => accumulator.addEvent(event));
        }
        converter.onUpstreamEnd().forEach(event => accumulator.addEvent(event));
        accumulator.onUpstreamEnd();
        expect(accumulator.isErrored()).toBe(true);
        expect(accumulator.isCompleted()).toBe(false);
    });
});


describe("multimodal request conversion regression", () => {
    it("converts OpenAI images to Anthropic image sources in place", () => {
        const result = convert(ApiFormat.OPENAI, ApiFormat.ANTHROPIC, {
            model: "test", messages: [{ role: "user", content: [
                { type: "text", text: "before" }, { type: "image_url", image_url: { url: imageUrl } }, { type: "text", text: "after" },
            ] }],
        });
        expect(result.messages[0].content).toEqual([{ type: "text", text: "before" }, anthropicImage, { type: "text", text: "after" }]);
    });

    it("converts Anthropic images to OpenAI image_url parts without losing text order", () => {
        const result = convert(ApiFormat.ANTHROPIC, ApiFormat.OPENAI, {
            model: "test", max_tokens: 64, messages: [{ role: "user", content: [
                { type: "text", text: "before" }, anthropicImage, { type: "text", text: "after" },
            ] }],
        });
        expect(result.messages[0].content).toEqual([
            { type: "text", text: "before" }, { type: "image_url", image_url: { url: imageUrl } }, { type: "text", text: "after" },
        ]);
    });

    it("keeps Anthropic text/image/text content in one ordered Responses message", () => {
        const result = convert(ApiFormat.ANTHROPIC, ApiFormat.RESPONSES, {
            model: "test", max_tokens: 64, messages: [{ role: "user", content: [
                { type: "text", text: "before" }, anthropicImage, { type: "text", text: "after" },
            ] }],
        });
        expect(result.input).toEqual([{ type: "message", role: "user", content: [
            { type: "input_text", text: "before" }, { type: "input_image", image_url: imageUrl }, { type: "input_text", text: "after" },
        ] }]);
    });

    it.each([ApiFormat.OPENAI, ApiFormat.ANTHROPIC])("preserves Responses text/image/text order when converting to %s", upstream => {
        const result = convert(ApiFormat.RESPONSES, upstream, { model: "test", input: [{ type: "message", role: "user", content: [
            { type: "input_text", text: "before" }, { type: "input_image", image_url: imageUrl }, { type: "input_text", text: "after" },
        ] }] });
        expect(result.messages[0].content).toEqual([
            { type: "text", text: "before" }, upstream === ApiFormat.OPENAI ? { type: "image_url", image_url: { url: imageUrl } } : anthropicImage,
            { type: "text", text: "after" },
        ]);
    });

    it.each([ApiFormat.OPENAI, ApiFormat.ANTHROPIC])("rejects unsupported Responses files and file-id images for %s", upstream => {
        for (const part of [{ type: "input_file", file_id: "file_1" }, { type: "input_image", file_id: "file_1" }]) {
            for (const item of [
                { type: "message", role: "user", content: [part] },
                { type: "function_call_output", call_id: "call_1", output: [part] },
                ...(part.type === "input_file" ? [{ type: "message", role: "system", content: [part] }] : []),
            ]) {
                expect(() => convert(ApiFormat.RESPONSES, upstream, { model: "test", input: [item] })).toThrow(expect.objectContaining({ statusCode: 400 }));
            }
        }
    });

    it.each([ApiFormat.OPENAI, ApiFormat.RESPONSES])("rejects invalid Anthropic image sources for %s", upstream => {
        for (const block of [
            { type: "image", source: { type: "base64", media_type: "image/png" } },
            { type: "image", source: { type: "url" } },
        ]) {
            for (const content of [[block], [{ type: "tool_result", tool_use_id: "call_1", content: [block] }]]) {
                expect(() => convert(ApiFormat.ANTHROPIC, upstream, { model: "test", max_tokens: 64, messages: [{ role: "user", content }] }))
                    .toThrow(expect.objectContaining({ statusCode: 400 }));
            }
        }
    });

    it.each([ApiFormat.ANTHROPIC, ApiFormat.RESPONSES])("rejects unsupported OpenAI content types for %s", upstream => {
        expect(() => convert(ApiFormat.OPENAI, upstream, { model: "test", messages: [{ role: "user", content: [{ type: "input_audio", input_audio: {} }] }] }))
            .toThrow(expect.objectContaining({ statusCode: 400 }));
    });

    it("supports remote image URLs and rejects non-base64 data URLs", () => {
        const result = convert(ApiFormat.OPENAI, ApiFormat.ANTHROPIC, { model: "test", messages: [{ role: "user", content: [
            { type: "image_url", image_url: { url: "https://example.test/image.png" } },
        ] }] });
        expect(result.messages[0].content[0].source).toEqual({ type: "url", url: "https://example.test/image.png" });
        expect(() => convert(ApiFormat.OPENAI, ApiFormat.ANTHROPIC, { model: "test", messages: [{ role: "user", content: [
            { type: "image_url", image_url: { url: "data:image/png,not-base64" } },
        ] }] })).toThrow(expect.objectContaining({ statusCode: 400 }));
    });

    it("merges tool results and following user content into one Anthropic turn", () => {
        const result = convert(ApiFormat.OPENAI, ApiFormat.ANTHROPIC, { model: "test", messages: [
            { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "read", arguments: "{}" } }] },
            { role: "tool", tool_call_id: "call_1", content: "result" },
            { role: "user", content: "continue" },
        ] });
        expect(result.messages).toHaveLength(2);
        expect(result.messages[1].content).toEqual([
            { type: "tool_result", tool_use_id: "call_1", content: "result" }, { type: "text", text: "continue" },
        ]);
    });

    it("maps Anthropic tool-result content into Responses content parts", () => {
        const result = convert(ApiFormat.ANTHROPIC, ApiFormat.RESPONSES, { model: "test", max_tokens: 64, messages: [{ role: "user", content: [
            { type: "tool_result", tool_use_id: "call_1", content: [{ type: "text", text: "result" }, anthropicImage] },
        ] }] });
        expect(result.input[0].output).toEqual([{ type: "input_text", text: "result" }, { type: "input_image", image_url: imageUrl }]);
    });

    it("maps Responses tool-result content into Anthropic blocks and merges the following user message", () => {
        const result = convert(ApiFormat.RESPONSES, ApiFormat.ANTHROPIC, { model: "test", input: [
            { type: "function_call", call_id: "call_1", name: "read", arguments: "{}" },
            { type: "function_call_output", call_id: "call_1", output: [{ type: "input_text", text: "result" }, { type: "input_image", image_url: imageUrl }] },
            { type: "message", role: "user", content: "continue" },
        ] });
        expect(result.messages).toHaveLength(2);
        expect(result.messages[1].content).toEqual([
            { type: "tool_result", tool_use_id: "call_1", content: [{ type: "text", text: "result" }, anthropicImage] },
            { type: "text", text: "continue" },
        ]);
    });

    it.each([ApiFormat.ANTHROPIC, ApiFormat.RESPONSES])("keeps all OpenAI tool messages adjacent before adding images from %s", client => {
        const calls = ["call_1", "call_2"];
        const request = client === ApiFormat.ANTHROPIC
            ? { model: "test", max_tokens: 64, messages: [
                { role: "assistant", content: calls.map(id => ({ type: "tool_use", id, name: "read", input: {} })) },
                { role: "user", content: calls.map(id => ({ type: "tool_result", tool_use_id: id, content: [{ type: "text", text: id }, anthropicImage] })) },
            ] }
            : { model: "test", input: [
                ...calls.map(call_id => ({ type: "function_call", call_id, name: "read", arguments: "{}" })),
                ...calls.map(call_id => ({ type: "function_call_output", call_id, output: [{ type: "input_text", text: call_id }, { type: "input_image", image_url: imageUrl }] })),
            ] };
        const result = convert(client, ApiFormat.OPENAI, request);
        expect(result.messages.map((message: { role: string }) => message.role)).toEqual(["assistant", "tool", "tool", "user"]);
        expect(result.messages[1].content).toBe("call_1");
        expect(result.messages[2].content).toBe("call_2");
        expect(result.messages[3].content).toEqual(calls.map(() => ({ type: "image_url", image_url: { url: imageUrl } })));
    });
});
