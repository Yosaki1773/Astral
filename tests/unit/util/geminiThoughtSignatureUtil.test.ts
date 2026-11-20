import { describe, expect, it } from "vitest";
import geminiThoughtSignatureUtil from "../../../src/util/protocol/geminiThoughtSignatureUtil";
import { ApiFormat } from "../../../src/constants";

const dummy = "skip_thought_signature_validator";


function toolCall(signature: unknown) {
    return {
        id: "call-1", type: "function",
        function: { name: "weather", arguments: '{"thought_signature":"business-value","signature":"keep"}' },
        extra_content: { google: { thought_signature: signature, other: "keep" } },
    };
}


describe("Gemini thought signature error recognition", () => {
    it.each(["Invalid thought signature", "Corrupted thought signature", "INVALID  THOUGHT_SIGNATURE", "Corrupted\nthought\tsignature at index 2"])
        ("recognizes a structured rejection: %s", message => {
            expect(geminiThoughtSignatureUtil.isRejectedSignatureError(400, JSON.stringify({ error: { message } }))).toBe(true);
        });

    it("recognizes top-level and non-JSON error messages", () => {
        expect(geminiThoughtSignatureUtil.isRejectedSignatureError(400, '{"message":"Invalid thought signature"}')).toBe(true);
        expect(geminiThoughtSignatureUtil.isRejectedSignatureError(400, "Error: Corrupted thought signature.")).toBe(true);
    });

    it.each([200, 401, 429, 500])("rejects status %s even with a signature error", status => {
        expect(geminiThoughtSignatureUtil.isRejectedSignatureError(status, "Invalid thought signature")).toBe(false);
    });

    it.each([
        "Invalid model", "Missing thought signature", "Invalid signature", "Corrupted thought process",
        '{"error":{"message":"Invalid model"},"data":{"message":"Invalid thought signature"}}',
        '{"messages":[{"content":"Invalid thought signature"}]}',
        '{"error":{"message":null}}', "null", '"Invalid thought signature"', "",
    ])("does not scan arbitrary JSON fields or unrelated errors: %s", text => {
        expect(geminiThoughtSignatureUtil.isRejectedSignatureError(400, text)).toBe(false);
    });
});


describe("Gemini thought signature replacement", () => {
    it("replaces all real signatures across history while preserving parallel calls and business fields", () => {
        const parallel = { id: "call-2", type: "function", function: { name: "taxi", arguments: "{}" } };
        const request = {
            model: "alias", messages: [
                { role: "user", content: "Invalid thought signature", tool_calls: [toolCall("user-metadata")] },
                { role: "assistant", content: null, tool_calls: [toolCall("backend-A"), parallel, toolCall(dummy), toolCall("")] },
                { role: "tool", tool_call_id: "call-1", content: '{"thought_signature":"tool-result"}' },
                { role: "assistant", content: [{ type: "thinking", signature: "anthropic-signature" }], tool_calls: [toolCall("backend-B")] },
            ],
            encrypted_content: "responses-opaque-value",
        };
        const original = JSON.stringify(request);
        const result = geminiThoughtSignatureUtil.replaceSignatures(original, ApiFormat.OPENAI);
        expect(result?.replacedSignatures).toBe(2);
        const expected = JSON.parse(original);
        expected.messages[1].tool_calls[0].extra_content.google.thought_signature = dummy;
        expected.messages[3].tool_calls[0].extra_content.google.thought_signature = dummy;
        expect(JSON.parse(result!.body)).toEqual(expected);
        expect(JSON.stringify(request)).toBe(original);
        expect(geminiThoughtSignatureUtil.replaceSignatures(result!.body, ApiFormat.OPENAI)).toBeNull();
    });

    it.each([undefined, null, "", 42, {}, [], dummy, "context_engineering_is_the_way_to_go"])
        ("does not invent or replace an absent/non-string/already bypassed signature: %s", signature => {
            const body = JSON.stringify({ messages: [{ role: "assistant", tool_calls: [toolCall(signature)] }] });
            expect(geminiThoughtSignatureUtil.replaceSignatures(body, ApiFormat.OPENAI)).toBeNull();
        });

    it.each([ApiFormat.ANTHROPIC, ApiFormat.RESPONSES])("does not reinterpret Gemini-like fields in protocol %s", format => {
        const body = JSON.stringify({ messages: [{ role: "assistant", tool_calls: [toolCall("foreign")] }] });
        expect(geminiThoughtSignatureUtil.replaceSignatures(body, format)).toBeNull();
    });

    it.each(["not json", "null", "[]", "{}", '{"messages":{}}', '{"messages":[null,42,{"role":"assistant","tool_calls":{}}]}'])
        ("leaves requests without supported slots alone: %s", body => {
            expect(geminiThoughtSignatureUtil.replaceSignatures(body, ApiFormat.OPENAI)).toBeNull();
        });

    it("repairs Responses function-call metadata without touching opaque reasoning or tool output", () => {
        const request = {
            model: "alias", previous_response_id: "resp-keep", input: [
                { type: "reasoning", encrypted_content: "opaque-reasoning", summary: [] },
                { type: "message", role: "user", content: "Invalid thought signature", extra_content: { google: { thought_signature: "user-keep" } } },
                { type: "function_call", call_id: "call-A", name: "weather", arguments: '{"thought_signature":"business-keep"}',
                    extra_content: { google: { thought_signature: "backend-A", other: "keep" } } },
                { type: "function_call_output", call_id: "call-A", output: '{"thought_signature":"output-keep"}' },
                { type: "function_call", call_id: "call-B", name: "taxi", arguments: "{}",
                    provider_specific_fields: { thought_signature: btoa("backend-B"), other: "keep" } },
                { type: "function_call", call_id: "call-C", name: "confirm", arguments: "{}" },
            ],
        };
        const original = JSON.stringify(request);
        const result = geminiThoughtSignatureUtil.replaceSignatures(original, ApiFormat.RESPONSES);
        expect(result?.replacedSignatures).toBe(2);
        const expected = JSON.parse(original);
        expected.input[2].extra_content.google.thought_signature = dummy;
        expected.input[4].provider_specific_fields.thought_signature = btoa(dummy);
        expect(JSON.parse(result!.body)).toEqual(expected);
        expect(JSON.stringify(request)).toBe(original);
        expect(geminiThoughtSignatureUtil.replaceSignatures(result!.body, ApiFormat.RESPONSES)).toBeNull();
    });

    it.each([ApiFormat.OPENAI, ApiFormat.RESPONSES])("repairs embedded signatures and matching tool-result references in %s", format => {
        const id = `call-A__thought__${btoa("backend-A")}`;
        const repairedId = `call-A__thought__${btoa(dummy)}`;
        const request = format === ApiFormat.RESPONSES ? { input: [
            { type: "function_call", id: "fc-keep", call_id: id, name: "weather", arguments: "{}" },
            { type: "function_call_output", call_id: id, output: id },
            { type: "function_call_output", call_id: "unrelated-call", output: "keep" },
        ] } : { messages: [
            { role: "assistant", tool_calls: [{ id, type: "function", function: { name: "weather", arguments: "{}" } }] },
            { role: "tool", tool_call_id: id, content: id },
        ] };
        const result = geminiThoughtSignatureUtil.replaceSignatures(JSON.stringify(request), format);
        expect(result?.replacedSignatures).toBe(1);
        const parsed = JSON.parse(result!.body);
        if (format === ApiFormat.RESPONSES) {
            expect(parsed.input[0].call_id).toBe(repairedId);
            expect(parsed.input[0].id).toBe("fc-keep");
            expect(parsed.input[1].call_id).toBe(repairedId);
            expect(parsed.input[1].output).toBe(id);
            expect(parsed.input[2].call_id).toBe("unrelated-call");
        } else {
            expect(parsed.messages[0].tool_calls[0].id).toBe(repairedId);
            expect(parsed.messages[1].tool_call_id).toBe(repairedId);
            expect(parsed.messages[1].content).toBe(id);
        }
        expect(geminiThoughtSignatureUtil.replaceSignatures(result!.body, format)).toBeNull();
    });

    it.each(["call-only", "call-A__thought__not-base64!", "call-A__thought__", `call-A__thought__${btoa(dummy)}`])
        ("does not rewrite unsupported or already bypassed embedded IDs: %s", call_id => {
            const body = JSON.stringify({ input: [{ type: "function_call", call_id, name: "weather", arguments: "{}" }] });
            expect(geminiThoughtSignatureUtil.replaceSignatures(body, ApiFormat.RESPONSES)).toBeNull();
        });

    it("leaves opaque Responses input and missing signatures untouched", () => {
        for (const input of ["Hello", null, {}, [], [{ type: "reasoning", encrypted_content: "foreign-signature" }]]) {
            expect(geminiThoughtSignatureUtil.replaceSignatures(JSON.stringify({ input }), ApiFormat.RESPONSES)).toBeNull();
        }
    });

    it("does not touch unknown message/content/native signature layouts or non-function calls", () => {
        const call = { ...toolCall("non-function"), type: "custom" };
        const body = JSON.stringify({
            messages: [{ role: "assistant", extra_content: { google: { thought_signature: "message-level" } },
                content: [{ thought_signature: "content-level" }], tool_calls: [call, null] }],
            contents: [{ parts: [{ thoughtSignature: "native-signature" }] }],
        });
        expect(geminiThoughtSignatureUtil.replaceSignatures(body, ApiFormat.OPENAI)).toBeNull();
    });
});
