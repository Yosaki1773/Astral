import { beforeAll, describe, expect, it } from "vitest";
import requestHelper from "../../helpers/requestHelper";
import mockHelper from "../../helpers/mockHelper";
import vendorFixtures from "../../fixtures/vendorFixtures";
import modelFixtures from "../../fixtures/modelFixtures";
import dbHelper from "../../helpers/dbHelper";
import { setupAdminUser } from "../../globalSetup";
import config from "../../config";


describe.skipIf(config.isRealMode)("record streaming reply preview", () => {
    let adminToken: string;
    let userToken: string;
    let modelId: number;
    const modelName = `reply-preview-${Date.now()}`;

    beforeAll(async () => {
        await dbHelper.truncate();
        adminToken = await setupAdminUser();
        const user = await requestHelper.post("/user/create.json", mockHelper.generateUser(), adminToken);
        userToken = user.body.token;
        const fixture = vendorFixtures.VENDOR_FIXTURES.openai();
        const vendor = await requestHelper.post("/vendor/create.json", {
            ...fixture,
            urls: { openai: `${fixture.urls.openai}/preview` },
        }, adminToken);
        expect(vendor.status).toBe(200);
        const model = await requestHelper.post("/model/create.json", modelFixtures.createRandomModel(vendor.body.id, modelName), adminToken);
        expect(model.status).toBe(200);
        modelId = model.body.id;
    });

    it("exposes growing reply snapshots while processing and keeps the final complete reply", async () => {
        const completion = requestHelper.post("/llm/v1/chat/completions", mockHelper.generateOpenAIChatRequest({ model: modelName, stream: true }), userToken);
        const partials: string[] = [];
        let recordId: number | undefined;
        const deadline = Date.now() + 8000;

        try {
            while (Date.now() < deadline) {
                const list = await requestHelper.get(`/record/list.json?model_ids=${modelId}`, adminToken);
                const record = list.body.list[0];
                if (record) {
                    recordId = record.id;
                    const detail = await requestHelper.get(`/record/${recordId}`, adminToken);
                    expect(detail.status).toBe(200);
                    if (detail.body.status !== "processing") break;
                    if (detail.body.response_data) {
                        const text = JSON.parse(detail.body.response_data).choices[0].message.content;
                        if (text && !partials.includes(text)) partials.push(text);
                    }
                }
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        } finally {
            const response = await completion;
            expect(response.status).toBe(200);
        }

        expect(partials.length).toBeGreaterThanOrEqual(2);
        expect(partials[1].length).toBeGreaterThan(partials[0].length);
        const [final] = await requestHelper.getFinalizedRecords(adminToken, 1);
        expect(final.id).toBe(recordId);
        expect(final.status).toBe("success");
        expect(JSON.parse(final.response_data).choices[0].message.content)
            .toBe("Hello! I am a mock AI assistant. How can I help you?");
    }, 15000);
});
