import { beforeAll, describe, expect, it } from "vitest";
import requestHelper from "../../helpers/requestHelper";
import upstreamCaptureHelper from "../../helpers/upstreamCaptureHelper";
import mockHelper from "../../helpers/mockHelper";
import modelFixtures from "../../fixtures/modelFixtures";
import dbHelper from "../../helpers/dbHelper";
import { setupAdminUser } from "../../globalSetup";
import config from "../../config";

const imageUrl = "data:image/png;base64,aGVsbG8=";
const anthropicImage = { type: "image", source: { type: "base64", media_type: "image/png", data: "aGVsbG8=" } };
const endpoints = { openai: "/llm/v1/chat/completions", anthropic: "/llm/v1/messages", responses: "/llm/v1/responses" };
type Format = keyof typeof endpoints;
let adminToken: string;
let userToken: string;

async function createModel(upstream: Format, suffix = "", failover = false) {
    const vendor = await requestHelper.post("/vendor/create.json", {
        type: "other", name: `core-port-${upstream}-${Date.now()}`, token: "test-token",
        urls: { [upstream]: `${config.UPSTREAM_CONFIG.mock.url}/${upstream === "openai" ? "chat/completions" : upstream === "anthropic" ? "messages" : "responses"}${suffix}` },
    }, adminToken);
    expect(vendor.status).toBe(200);
    const name = `core-port-model-${vendor.body.id}`;
    const model = await requestHelper.post("/model/create.json", {
        ...modelFixtures.createRandomModel(vendor.body.id, name),
        routing_config: { upstreams: [{ vendor_id: vendor.body.id, enabled: true }], failover: { enabled: failover } },
    }, adminToken);
    expect(model.status).toBe(200);
    return { name, modelId: model.body.id, vendorId: vendor.body.id };
}

function imageRequest(format: Format, model: string) {
    if (format === "openai") return { model, messages: [{ role: "user", content: [{ type: "text", text: "before" }, { type: "image_url", image_url: { url: imageUrl } }, { type: "text", text: "after" }] }] };
    if (format === "anthropic") return { model, max_tokens: 64, messages: [{ role: "user", content: [{ type: "text", text: "before" }, anthropicImage, { type: "text", text: "after" }] }] };
    return { model, input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "before" }, { type: "input_image", image_url: imageUrl }, { type: "input_text", text: "after" }] }] };
}


describe("priority core port API regression", () => {
    beforeAll(async () => {
        await dbHelper.truncate();
        adminToken = await setupAdminUser();
        const user = await requestHelper.post("/user/create.json", mockHelper.generateUser(), adminToken);
        expect(user.status).toBe(200);
        userToken = user.body.token;
    });

    it.each([
        ["openai", "anthropic"], ["anthropic", "openai"], ["anthropic", "responses"],
        ["responses", "anthropic"], ["responses", "openai"], ["openai", "responses"],
    ] as [Format, Format][])("sends ordered image content from %s to %s", async (client, upstream) => {
        const model = await createModel(upstream);
        const response = await requestHelper.post(endpoints[client], imageRequest(client, model.name), userToken);
        expect(response.status).toBe(200);
        const requests = await upstreamCaptureHelper.list();
        const sent = requests.find(request => request.json?.model === model.name)!;
        expect(sent).toBeDefined();
        const content = upstream === "responses" ? sent.json.input[0].content : sent.json.messages[0].content;
        expect(content).toEqual(upstream === "responses" ? [
            { type: "input_text", text: "before" }, { type: "input_image", image_url: imageUrl }, { type: "input_text", text: "after" },
        ] : [
            { type: "text", text: "before" }, upstream === "anthropic" ? anthropicImage : { type: "image_url", image_url: { url: imageUrl } }, { type: "text", text: "after" },
        ]);
    });

    it.each(["openai", "anthropic"] as Format[])("rejects Responses files for %s and finalizes the record", async upstream => {
        const model = await createModel(upstream);
        const response = await requestHelper.post(endpoints.responses, { model: model.name, input: [{ role: "user", content: [{ type: "input_file", file_id: "file_1" }] }] }, userToken);
        expect(response.status).toBe(400);
        const record = (await requestHelper.getFinalizedRecords(adminToken, 1))[0];
        expect(record.model_id).toBe(model.modelId);
        expect(record.status).toBe("failed");
        expect(record.end_at).toBeTruthy();
        expect(record.cost).toBe(0);
        expect((await upstreamCaptureHelper.list()).some(request => request.json?.model === model.name)).toBe(false);
    });

    it.each(["openai", "responses"] as Format[])("rejects invalid Anthropic tool-result images for %s", async upstream => {
        const model = await createModel(upstream);
        const response = await requestHelper.post(endpoints.anthropic, { model: model.name, max_tokens: 64, messages: [{ role: "user", content: [
            { type: "tool_result", tool_use_id: "call_1", content: [{ type: "image", source: { type: "base64", media_type: "image/png" } }] },
        ] }] }, userToken);
        expect(response.status).toBe(400);
        const record = (await requestHelper.getFinalizedRecords(adminToken, 1))[0];
        expect(record.status).toBe("failed");
        expect(record.model_id).toBe(model.modelId);
    });

    it.each([
        ["openai", "responses", "/stream-failed"],
        ["anthropic", "responses", "/stream-failed"],
        ["responses", "openai", "/stream-error"],
    ] as [Format, Format, string][])("forwards errors from %s clients through %s and records failure", async (client, upstream, suffix) => {
        const model = await createModel(upstream, suffix);
        const response = await requestHelper.post(endpoints[client], { ...imageRequest(client, model.name), stream: true }, userToken);
        expect(response.status).toBe(200);
        expect(response.body).toContain("upstream failed");
        const record = (await requestHelper.getFinalizedRecords(adminToken, 1))[0];
        expect(record.model_id).toBe(model.modelId);
        expect(record.status).toBe("failed");
        expect(record.failed_code).toBe("upstream_error");
        expect(record.cost).toBe(0);
    });

    it("retains a selected routed vendor model and its formats when syncing models", async () => {
        const model = await createModel("openai");
        const old = await requestHelper.post(`/vendor/${model.vendorId}/model/add.json`, { model_id: "old-upstream" }, adminToken);
        expect(old.status).toBe(200);
        await requestHelper.put(`/vendor/${model.vendorId}/model/${old.body.id}`, { allowed_formats: ["openai"] }, adminToken);
        const updated = await requestHelper.put(`/model/${model.modelId}`, {
            ...modelFixtures.createRandomModel(model.vendorId, model.name),
            routing_config: { upstreams: [{ vendor_id: model.vendorId, vendor_model_id: old.body.id, enabled: true }] },
        }, adminToken);
        expect(updated.status).toBe(200);
        const synced = await requestHelper.post(`/vendor/${model.vendorId}/model/sync.json`, { model_ids: ["old-upstream", "new-upstream"] }, adminToken);
        expect(synced.status).toBe(200);
        expect(synced.body.find((item: { id: number }) => item.id === old.body.id)).toMatchObject({ model_id: "old-upstream", allowed_formats: ["openai"] });
        const response = await requestHelper.post(endpoints.openai, { model: model.name, messages: [{ role: "user", content: "hi" }] }, userToken);
        expect(response.status).toBe(200);
        expect(response.body.model).toBe("old-upstream");
    });

    it.each([false, true])("records unreachable upstreams with failover=%s", async failover => {
        const vendor = await requestHelper.post("/vendor/create.json", { type: "other", name: `unreachable-port-${failover}`, token: "test", urls: { openai: "http://127.0.0.1:65534/v1/chat/completions" } }, adminToken);
        const name = `unreachable-port-${vendor.body.id}`;
        await requestHelper.post("/model/create.json", { ...modelFixtures.createRandomModel(vendor.body.id, name), routing_config: { upstreams: [{ vendor_id: vendor.body.id, enabled: true }], failover: { enabled: failover } } }, adminToken);
        const response = await requestHelper.post(endpoints.openai, { model: name, messages: [{ role: "user", content: "hi" }] }, userToken);
        expect(response.status).toBeGreaterThanOrEqual(500);
        const record = (await requestHelper.getFinalizedRecords(adminToken, 1))[0];
        expect(record.failed_code).toBe("upstream_unreachable");
        expect(record.response_data).toContain(config.TEST_MODE === "worker" ? "Network connection lost." : "ECONNREFUSED");
    });
});
