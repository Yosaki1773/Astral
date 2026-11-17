import { beforeAll, describe, expect, it } from "vitest";
import requestHelper from "../../helpers/requestHelper";
import upstreamCaptureHelper from "../../helpers/upstreamCaptureHelper";
import dbHelper from "../../helpers/dbHelper";
import modelFixtures from "../../fixtures/modelFixtures";
import mockHelper from "../../helpers/mockHelper";
import { setupAdminUser } from "../../globalSetup";
import config from "../../config";

let adminToken: string;
let userToken: string;
const baseUrl = config.UPSTREAM_CONFIG.mock.url;

async function createVendor(name: string, urls: Record<string, string> = { openai: baseUrl }, model_ids: string[] = []) {
    const response = await requestHelper.post("/vendor/create.json", { type: "other", name, token: "test-key", urls, model_ids }, adminToken);
    expect(response.status).toBe(200);
    return response.body;
}


describe("vendor management workflow", () => {
    beforeAll(async () => {
        await dbHelper.truncate();
        adminToken = await setupAdminUser();
        const user = await requestHelper.post("/user/create.json", mockHelper.generateUser(), adminToken);
        userToken = user.body.token;
    });

    it("fetches models with an unsaved connection and never creates a vendor", async () => {
        const before = await requestHelper.get("/vendor/list.json", adminToken);
        const response = await requestHelper.post("/vendor/model/fetch.json", {
            type: "other", token: "draft-key", urls: { anthropic: `${baseUrl}///` }, config: { auth_mode: "api_key" },
        }, adminToken);
        expect(response.status).toBe(200);
        expect(response.body.models).toContain("mock-gpt-4o");
        const request = (await upstreamCaptureHelper.list()).find(request => request.headers["x-api-key"] === "draft-key")!;
        expect(request.url).toBe("/v1/models");
        const after = await requestHelper.get("/vendor/list.json", adminToken);
        expect(after.body.total).toBe(before.body.total);
        expect((await requestHelper.post("/vendor/model/fetch.json", { type: "other", token: "key" })).status).toBe(401);
        expect((await requestHelper.post("/vendor/model/fetch.json", { type: "other" }, adminToken)).status).toBe(400);
    });

    it("saves selections with create/edit and returns precise model references", async () => {
        const vendor = await createVendor("configured", undefined, ["unreferenced", "upstream", "auto-model"]);
        const models = (await requestHelper.get(`/vendor/${vendor.id}/model/list.json`, adminToken)).body;
        const upstream = models.find((model: any) => model.model_id === "upstream");
        await requestHelper.put(`/vendor/${vendor.id}/model/${upstream.id}`, { allowed_formats: ["openai"] }, adminToken);
        for (const name of ["system-one", "system-two"]) {
            const created = await requestHelper.post("/model/create.json", {
                ...modelFixtures.createRandomModel(vendor.id, name),
                routing_config: { upstreams: [{ vendor_id: vendor.id, vendor_model_id: upstream.id, enabled: true }] },
            }, adminToken);
            expect(created.status).toBe(200);
        }
        expect((await requestHelper.post("/model/create.json", modelFixtures.createRandomModel(vendor.id, "auto-model"), adminToken)).status).toBe(200);
        const list = (await requestHelper.get("/vendor/list.json", adminToken)).body.list;
        const summary = list.find((row: any) => row.id === vendor.id).models;
        expect(summary.find((model: any) => model.model_id === "upstream").system_model_names.sort()).toEqual(["system-one", "system-two"]);
        expect(summary.find((model: any) => model.model_id === "auto-model").system_model_names).toEqual(["auto-model"]);
        expect(summary.find((model: any) => model.model_id === "unreferenced").system_model_names).toEqual([]);
        const update = await requestHelper.put(`/vendor/${vendor.id}`, { name: "updated", model_ids: ["upstream", "auto-model"] }, adminToken);
        expect(update.status).toBe(200);
        const saved = (await requestHelper.get(`/vendor/${vendor.id}/model/list.json`, adminToken)).body;
        expect(saved.find((model: any) => model.model_id === "upstream")).toMatchObject({ id: upstream.id, allowed_formats: ["openai"] });
        expect(saved).toHaveLength(2);
        await requestHelper.put(`/vendor/${vendor.id}`, { token: "changed" }, adminToken);
        expect((await requestHelper.get(`/vendor/${vendor.id}/model/list.json`, adminToken)).body).toHaveLength(2);
        expect((await requestHelper.put(`/vendor/${vendor.id}`, { model_ids: [null] }, adminToken)).status).toBe(400);
        const clear = await requestHelper.put(`/vendor/${vendor.id}`, { model_ids: [] }, adminToken);
        expect(clear.status).toBe(200);
        expect((await requestHelper.get(`/vendor/${vendor.id}/model/list.json`, adminToken)).body).toEqual([]);
    });

    it("records actual successful and failed model calls and sorts before pagination", async () => {
        const old = await createVendor("called-old");
        const never = await createVendor("never-called");
        const failed = await createVendor("called-failed", { openai: "http://127.0.0.1:65534" });
        const newestNever = await createVendor("newest-never-called");
        await requestHelper.post(`/vendor/${old.id}/test.json`, { model: "ping", format: "openai" }, adminToken);
        const result = await requestHelper.post(`/vendor/${failed.id}/test.json`, { model: "ping", format: "openai" }, adminToken);
        expect(result.body.success).toBe(false);
        const first = (await requestHelper.get("/vendor/list.json?pageSize=2", adminToken)).body.list;
        expect(first.map((row: any) => row.id)).toEqual([failed.id, old.id]);
        expect(first.every((row: any) => typeof row.last_called_at === "number")).toBe(true);
        const second = (await requestHelper.get("/vendor/list.json?page=2&pageSize=2", adminToken)).body.list;
        expect(second.map((row: any) => row.id)).toEqual([newestNever.id, never.id]);
        await requestHelper.get(`/vendor/${never.id}/model/fetch.json`, adminToken);
        expect((await requestHelper.get(`/vendor/${never.id}`, adminToken)).body.last_called_at).toBeNull();
    });

    it("tracks both vendors in a real failover model request", async () => {
        const name = "failover-tracked";
        const bad = await createVendor("failover-bad", { openai: "http://127.0.0.1:65534" }, [name]);
        const good = await createVendor("failover-good", undefined, [name]);
        expect((await requestHelper.post("/model/create.json", {
            ...modelFixtures.createRandomModel(bad.id, name), routing_mode: "first_available",
            routing_config: { upstreams: [{ vendor_id: bad.id, enabled: true }, { vendor_id: good.id, enabled: true }], failover: { enabled: true } },
        }, adminToken)).status).toBe(200);
        const response = await requestHelper.post("/llm/v1/chat/completions", { model: name, messages: [{ role: "user", content: "hi" }] }, userToken);
        expect(response.status).toBe(200);
        const badVendor = (await requestHelper.get(`/vendor/${bad.id}`, adminToken)).body;
        const goodVendor = (await requestHelper.get(`/vendor/${good.id}`, adminToken)).body;
        expect(badVendor.last_called_at).toBeGreaterThan(0);
        expect(goodVendor.last_called_at).toBeGreaterThanOrEqual(badVendor.last_called_at);
    });
});
