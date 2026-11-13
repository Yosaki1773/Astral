import { describe, expect, it } from "vitest";
import upstreamFailureUtil from "../../../../src/util/protocol/upstreamFailureUtil";
import { ApiFormat } from "../../../../src/constants";


describe("explicit upstream failure states with missing details", () => {
    it.each([{}, { error: null }, { error: {} }])("recognizes Responses status=failed with %j", details => {
        expect(upstreamFailureUtil.detectUpstreamBodyFailure(ApiFormat.RESPONSES, JSON.stringify({ status: "failed", ...details })))
            .toEqual({ code: null });
    });

    it.each([ApiFormat.RESPONSES, ApiFormat.ANTHROPIC])("recognizes %s type=error even when details are missing", format => {
        expect(upstreamFailureUtil.detectUpstreamBodyFailure(format, JSON.stringify({ type: "error" }))).toEqual({ code: null });
    });
});
