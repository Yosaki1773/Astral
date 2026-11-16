import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SgVendor, SgVendorConfig } from "../../src/model/sgVendor";
import vendorManager from "../../src/manager/vendorManager";
import vendorModelManager from "../../src/manager/vendorModelManager";
import dbHelper from "../helpers/dbHelper";
import ormTestHelper from "../helpers/ormTestHelper";


describe("vendor model selection sync regression", () => {
    beforeAll(() => ormTestHelper.connectNodeOrm());
    beforeEach(() => dbHelper.truncate());

    it("deletes omitted models while preserving selected model ids and allowed formats", async () => {
        const vendor = await vendorManager.create(new SgVendor({ type: "other", name: "sync-regression", token: "test", config: new SgVendorConfig({}) }));
        const old = await vendorModelManager.add(vendor.id, "old-model");
        await vendorModelManager.update(old.id, vendor.id, JSON.stringify(["openai"]));
        const omitted = await vendorModelManager.add(vendor.id, "omitted-model");
        const result = await vendorModelManager.syncByVendor(vendor.id, ["old-model", "new-model"]);
        expect(result.map(model => model.model_id)).toEqual(["new-model", "old-model"]);
        expect(result.find(model => model.model_id === "old-model")).toMatchObject({ id: old.id, allowed_formats: JSON.stringify(["openai"]) });
        expect(await vendorModelManager.getByIds([old.id])).toHaveLength(1);
        expect(await vendorModelManager.getByIds([omitted.id])).toHaveLength(0);
        expect(await vendorModelManager.syncByVendor(vendor.id, [])).toHaveLength(0);
    });
});
