import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import vendorService from "../../src/service/vendorService";
import vendorManager from "../../src/manager/vendorManager";
import vendorModelManager from "../../src/manager/vendorModelManager";
import ormService from "../../src/service/ormService";
import ormTestHelper from "../helpers/ormTestHelper";
import dbHelper from "../helpers/dbHelper";
import { SgModel } from "../../src/model/sgModel";


describe("vendor management persistence (node)", () => {
    beforeAll(() => ormTestHelper.connectNodeOrm());
    beforeEach(() => dbHelper.truncate());

    it("saves models together, preserves ids/formats, and distinguishes omitted and empty selections", async () => {
        const vendor = await vendorService.createVendor({ type: "other", name: "draft-save", token: "key", model_ids: [" old ", "old", "new"] }, 1);
        expect((await vendorModelManager.listByVendor(vendor.id)).map(model => model.model_id)).toEqual(["new", "old"]);
        const old = (await vendorModelManager.listByVendor(vendor.id)).find(model => model.model_id === "old")!;
        await vendorModelManager.update(old.id, vendor.id, '["openai"]');
        await vendorService.updateVendor(vendor.id, { name: "renamed", model_ids: ["old", "added"] }, 1);
        expect(await vendorModelManager.findById(old.id)).toMatchObject({ model_id: "old", allowed_formats: '["openai"]' });
        await vendorService.updateVendor(vendor.id, { token: "changed" }, 1);
        expect(await vendorModelManager.listByVendor(vendor.id)).toHaveLength(2);
        await vendorService.updateVendor(vendor.id, { model_ids: [] }, 1);
        expect(await vendorModelManager.listByVendor(vendor.id)).toHaveLength(0);
    });

    it("rolls back vendor edits and model deletions when a model insert fails", async () => {
        const vendor = await vendorService.createVendor({ type: "other", name: "rollback", token: "key", model_ids: ["old"] }, 1);
        const originalSync = vendorModelManager.syncByVendor;
        const spy = vi.spyOn(vendorModelManager, "syncByVendor").mockImplementation(async (id, ids, transaction) => {
            await originalSync(id, ids, transaction);
            throw new Error("injected persistence failure");
        });
        try {
            await expect(vendorService.updateVendor(vendor.id, { name: "must-rollback", model_ids: ["replacement"] }, 1)).rejects.toThrow("injected persistence failure");
            expect(await vendorManager.findById(vendor.id)).toMatchObject({ name: "rollback" });
            expect((await vendorModelManager.listByVendor(vendor.id)).map(model => model.model_id)).toEqual(["old"]);
            await expect(vendorService.createVendor({ type: "other", name: "failed-create", token: "key", model_ids: ["new"] }, 1)).rejects.toThrow("injected persistence failure");
            expect(await vendorManager.findByName("failed-create", 1)).toBeNull();
        } finally { spy.mockRestore(); }
    });

    it("rejects invalid selections before writing and respects tenant scope", async () => {
        const vendor = await vendorService.createVendor({ type: "other", name: "scoped", token: "key", model_ids: ["old"] }, 1);
        for (const model_ids of [null, "old", [1], [" "]]) {
            await expect(vendorService.updateVendor(vendor.id, { name: "bad", model_ids }, 1)).rejects.toMatchObject({ statusCode: 400 });
        }
        expect(await vendorService.updateVendor(vendor.id, { model_ids: [] }, 2)).toBeNull();
        expect(await vendorModelManager.listByVendor(vendor.id)).toHaveLength(1);
    });

    it("orders all pages by latest call and keeps never-called vendors in original relative order", async () => {
        const ids: number[] = [];
        for (let i = 0; i < 5; i++) ids.push((await vendorService.createVendor({ type: "other", name: `vendor-${i}`, token: "key" }, 1)).id);
        await vendorManager.markCalled(ids[0], 1000);
        await vendorManager.markCalled(ids[2], 2000);
        await vendorManager.markCalled(ids[0], 500); // 较早并发请求不能倒写。
        const scope = { tenantId: 1, mainTenantId: 1 } as any;
        const first = await vendorManager.list({ pageSize: 2, offset: 0 }, scope);
        const second = await vendorManager.list({ pageSize: 3, offset: 2 }, scope);
        expect(first.list.map(vendor => vendor.id)).toEqual([ids[2], ids[0]]);
        expect(second.list.map(vendor => vendor.id)).toEqual([ids[4], ids[3], ids[1]]);
        expect(first.total).toBe(5);
        expect((await vendorManager.findById(ids[0]))!.last_called_at).toBe(1000);
    });

    it("backfills the next migration from existing record timestamps", async () => {
        const vendor = await vendorService.createVendor({ type: "other", name: "historical", token: "key" }, 1);
        const never = await vendorService.createVendor({ type: "other", name: "no-history", token: "key" }, 1);
        const knex = ormService.getKnex();
        await knex("record").insert({ user_id: 1, model_id: 1, vendor_id: vendor.id, start_at: "2026-11-01 12:30:45", status: "success", cost: 0 });
        // 执行迁移的回填语句，schema 由统一 globalSetup 管理。
        await knex.raw(process.env.DB_DRIVER === "mysql"
            ? "UPDATE vendor SET last_called_at = (SELECT TIMESTAMPDIFF(MICROSECOND, '1970-01-01 00:00:00', MAX(COALESCE(start_at, created_at))) DIV 1000 FROM record WHERE record.vendor_id = vendor.id)"
            : "UPDATE vendor SET last_called_at = (SELECT CAST(strftime('%s', MAX(COALESCE(start_at, created_at))) AS INTEGER) * 1000 FROM record WHERE record.vendor_id = vendor.id)");
        expect((await vendorManager.findById(vendor.id))!.last_called_at).toBe(Date.parse("2026-11-01T12:30:45Z"));
        expect((await vendorManager.findById(never.id))!.last_called_at).toBeNull();
    });

    it("maps only exact supplier model references within the supplier tenant, including disabled configuration", async () => {
        const vendor = await vendorService.createVendor({ type: "other", name: "reference-vendor", token: "key", model_ids: ["upstream", "auto", "unused"] }, 1);
        const foreign = await vendorService.createVendor({ type: "other", name: "foreign-vendor", token: "key", model_ids: ["upstream"] }, 2);
        const model = (await vendorModelManager.listByVendor(vendor.id)).find(model => model.model_id === "upstream")!;
        for (const data of [
            { name: "explicit", tenant_id: 1, vendor_id: vendor.id, vendor_model_id: model.id },
            { name: "disabled", tenant_id: 1, vendor_id: vendor.id, vendor_model_id: model.id },
            { name: "auto", tenant_id: 1, vendor_id: vendor.id },
            { name: "foreign-reference", tenant_id: 2, vendor_id: vendor.id, vendor_model_id: model.id },
            { name: "wrong-vendor", tenant_id: 1, vendor_id: foreign.id, vendor_model_id: model.id },
        ]) {
            await new SgModel({ name: data.name, tenant_id: data.tenant_id, routing_mode: "single", enable: data.name !== "disabled",
                routing_config: { upstreams: [{ vendor_id: data.vendor_id, vendor_model_id: data.vendor_model_id, enabled: data.name !== "disabled" }] },
            }).save();
        }
        const summaries = await vendorService.getModelSummaries([vendor.id], 1);
        expect(summaries[vendor.id].find(model => model.model_id === "upstream")!.system_model_names.sort()).toEqual(["disabled", "explicit"]);
        expect(summaries[vendor.id].find(model => model.model_id === "auto")!.system_model_names).toEqual(["auto"]);
        expect(summaries[vendor.id].find(model => model.model_id === "unused")!.system_model_names).toEqual([]);
    });

    it.skipIf(process.env.DB_DRIVER === "mysql")("uses D1 batch with a materialized new vendor id and rolls back the entire batch", async () => {
        const knex = ormService.getKnex();
        // 用 SQLite 执行真实 D1 方言，验证 batch 的原子性和 rowid 不被子表 INSERT 改变。
        const db = {
            prepare(sql: string) { return { bind(...bindings: any[]) { return { sql, bindings }; } }; },
            async batch(statements: Array<{ sql: string; bindings: any[] }>) {
                return knex.transaction(async (transaction: any) => {
                    const results = [];
                    for (const statement of statements) {
                        const rows = await transaction.raw(statement.sql, statement.bindings);
                        results.push({ results: Array.isArray(rows) ? rows : [] });
                    }
                    return results;
                });
            },
        } as unknown as D1Database;
        const worker = vi.spyOn(ormService, "isWorker", "get").mockReturnValue(true);
        try {
            const first = await vendorService.createVendor({ type: "other", name: "d1-first", token: "key", model_ids: ["one", "two", "three"] }, 1, db);
            const second = await vendorService.createVendor({ type: "other", name: "d1-second", token: "key", model_ids: ["four", "five"] }, 1, db);
            expect((await vendorModelManager.listByVendor(first.id)).map(model => model.model_id)).toEqual(["one", "three", "two"]);
            expect((await vendorModelManager.listByVendor(second.id)).map(model => model.model_id)).toEqual(["five", "four"]);
            await vendorService.updateVendor(first.id, { model_ids: ["one", "new"] }, 1, db);
            expect((await vendorModelManager.listByVendor(first.id)).map(model => model.model_id)).toEqual(["new", "one"]);
            await knex.raw("CREATE TRIGGER reject_model BEFORE INSERT ON vendor_model WHEN NEW.model_id = 'reject' BEGIN SELECT RAISE(ABORT, 'rejected model'); END");
            try {
                await expect(vendorService.updateVendor(first.id, { name: "rollback-d1", model_ids: ["reject"] }, 1, db)).rejects.toThrow();
                expect((await vendorManager.findById(first.id))!.name).toBe("d1-first");
                expect(await vendorModelManager.listByVendor(first.id)).toHaveLength(2);
            } finally { await knex.raw("DROP TRIGGER reject_model"); }
        } finally { worker.mockRestore(); }
    });
});
