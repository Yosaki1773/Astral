import { describe, it, expect, beforeAll } from "vitest";
import requestHelper from "../../helpers/requestHelper";
import mockHelper from "../../helpers/mockHelper";
import dbHelper from "../../helpers/dbHelper";
import upstreamCaptureHelper from "../../helpers/upstreamCaptureHelper";
import { setupAdminUser } from "../../globalSetup";
import config from "../../config";

/**
 * 上游 User-Agent 按供应商配置测试
 *
 * vendor.config 支持 user_agent_enabled 开关 + user_agent 自定义值：
 * - 开关关闭：网关不注入 UA 头（上游只见运行时默认 UA，Node 模式下为 "node"）
 * - 开启 + 留空：注入默认 claude-cli UA
 * - 开启 + 自定义：注入自定义值
 * 三条上游出口（网关模型请求 / 连通性测试 / 获取模型列表）行为一致。
 */

const MOCK_BASE = config.UPSTREAM_CONFIG.mock.url;
const DEFAULT_UA = "claude-cli/2.1.161 (external, cli)";
const CUSTOM_UA = "custom-agent/1.0 (test)";

let testUserToken: string;
let adminToken: string;

interface VendorModelPair {
    vendorId: number;
    modelName: string;
}

let disabledVendor: VendorModelPair;
let defaultVendor: VendorModelPair;
let customVendor: VendorModelPair;

async function createVendorAndModel(
    name: string,
    vendorConfig: Record<string, any> | undefined,
): Promise<VendorModelPair> {
    const vendorResponse = await requestHelper.post(
        "/vendor/create.json",
        {
            type: "other",
            name,
            token: "test-token",
            urls: { openai: `${MOCK_BASE}/chat/completions` },
            ...(vendorConfig !== undefined ? { config: vendorConfig } : {}),
        },
        adminToken,
    );
    expect(vendorResponse.status).toBe(200);
    const vendorId = vendorResponse.body.id;

    const modelName = `ua-${name}-${Date.now()}`;
    const modelResponse = await requestHelper.post(
        "/model/create.json",
        {
            name: modelName,
            enable: true,
            prices: {},
            routing_mode: "single",
            routing_config: { upstreams: [{ vendor_id: vendorId, enabled: true }] },
        },
        adminToken,
    );
    expect(modelResponse.status).toBe(200);

    return { vendorId, modelName };
}


describe("Upstream User-Agent per vendor", () => {
    beforeAll(async () => {
        await dbHelper.truncate();
        adminToken = await setupAdminUser();

        const userResponse = await requestHelper.post(
            "/user/create.json",
            mockHelper.generateUser(),
            adminToken,
        );
        testUserToken = userResponse.body.token;

        // A：无 config（开关关闭）——不注入 UA
        disabledVendor = await createVendorAndModel("ua-disabled", undefined);
        // B：开启 + 留空——注入默认 UA
        defaultVendor = await createVendorAndModel("ua-default", {
            user_agent_enabled: true,
        });
        // C：开启 + 自定义——注入自定义 UA
        customVendor = await createVendorAndModel("ua-custom", {
            user_agent_enabled: true,
            user_agent: CUSTOM_UA,
        });
    });

    it("should preserve config shape: disabled vendor has no UA fields", async () => {
        const response = await requestHelper.get(`/vendor/${disabledVendor.vendorId}`, adminToken);
        expect(response.status).toBe(200);
        expect(response.body.config).toEqual({ auth_mode: "bearer_token", skip_tls_verify: false });
    });

    it("should store user_agent_enabled in vendor config", async () => {
        const response = await requestHelper.get(`/vendor/${defaultVendor.vendorId}`, adminToken);
        expect(response.status).toBe(200);
        expect(response.body.config.user_agent_enabled).toBe(true);
    });

    describe("gateway requests (llm endpoint)", () => {
        async function sendChat(modelName: string): Promise<Record<string, string>> {
            const chatRequest = mockHelper.generateOpenAIChatRequest({
                model: modelName,
                stream: false,
            });
            const response = await requestHelper.post(
                "/llm/v1/chat/completions",
                chatRequest,
                testUserToken,
            );
            expect(response.status).toBe(200);
            return response.body._received_headers;
        }

        it("should send default UA when enabled with empty value", async () => {
            const headers = await sendChat(defaultVendor.modelName);
            expect(headers["user-agent"]).toBe(DEFAULT_UA);
        }, 30000);

        it("should send custom UA when enabled with value", async () => {
            const headers = await sendChat(customVendor.modelName);
            expect(headers["user-agent"]).toBe(CUSTOM_UA);
        }, 30000);

        it("should not inject configured UA when disabled (runtime default passes through)", async () => {
            const headers = await sendChat(disabledVendor.modelName);
            // 运行时会带自己的默认 UA（node 模式为 "node"），这里断言网关未注入配置值
            expect(headers["user-agent"]).not.toBe(DEFAULT_UA);
            expect(headers["user-agent"]).not.toBe(CUSTOM_UA);
        }, 30000);
    });

    describe("vendor connectivity test", () => {
        it("should include default UA in test request headers when enabled with empty value", async () => {
            const response = await requestHelper.post(
                `/vendor/${defaultVendor.vendorId}/test.json`,
                { format: "openai", model: "gpt-4" },
                adminToken,
            );
            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            // request_headers 来自 fetch 前构建的 Headers，可精确断言
            expect(response.body.request_headers["user-agent"]).toBe(DEFAULT_UA);
        });

        it("should include custom UA in test request headers when enabled with value", async () => {
            const response = await requestHelper.post(
                `/vendor/${customVendor.vendorId}/test.json`,
                { format: "openai", model: "gpt-4" },
                adminToken,
            );
            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.request_headers["user-agent"]).toBe(CUSTOM_UA);
        });

        it("should not set UA header when disabled", async () => {
            const response = await requestHelper.post(
                `/vendor/${disabledVendor.vendorId}/test.json`,
                { format: "openai", model: "gpt-4" },
                adminToken,
            );
            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            // 未开启开关时 buildRequest 完全不设置 UA（fetch 注入发生在之后）
            expect(response.body.request_headers["user-agent"]).toBeUndefined();
        });
    });

    describe("fetch upstream models", () => {
        async function getLastModelsRequestUa(vendorId: number): Promise<string | undefined> {
            const response = await requestHelper.get(
                `/vendor/${vendorId}/model/fetch.json`,
                adminToken,
            );
            expect(response.status).toBe(200);
            expect(response.body.models).toContain("mock-gpt-4o");

            const requests = await upstreamCaptureHelper.list();
            const modelsRequests = requests.filter(
                r => r.method === "GET" && r.url.includes("/models"),
            );
            expect(modelsRequests.length).toBeGreaterThan(0);
            return modelsRequests[modelsRequests.length - 1].headers["user-agent"];
        }

        it("should send default UA when enabled with empty value", async () => {
            const ua = await getLastModelsRequestUa(defaultVendor.vendorId);
            expect(ua).toBe(DEFAULT_UA);
        });

        it("should send custom UA when enabled with value", async () => {
            const ua = await getLastModelsRequestUa(customVendor.vendorId);
            expect(ua).toBe(CUSTOM_UA);
        });

        it("should not inject configured UA when disabled", async () => {
            const ua = await getLastModelsRequestUa(disabledVendor.vendorId);
            expect(ua).not.toBe(DEFAULT_UA);
            expect(ua).not.toBe(CUSTOM_UA);
        });
    });
});
