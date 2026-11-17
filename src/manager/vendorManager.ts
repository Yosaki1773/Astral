import { SgVendor } from "../model/sgVendor";
import ormService from "../service/ormService";
import vendorModelManager from "./vendorModelManager";
import type { TenantScope } from "../middleware/tenantScopeMiddleware";

interface VendorListOptions {
    type?: string;
    keyword?: string;
    pageSize: number;
    offset: number;
}

async function findById(vendorId: number): Promise<SgVendor | null> {
    return await SgVendor.query().find(vendorId);
}

async function findByIdInTenant(vendorId: number, tenantId: number): Promise<SgVendor | null> {
    return await SgVendor.query().where("id", vendorId).where("tenant_id", tenantId).first();
}

async function findByName(name: string, tenantId?: number): Promise<SgVendor | null> {
    if (name == null) {
        return null;
    }

    const q = SgVendor.query().where("name", name);
    if (tenantId !== undefined) {
        q.where("tenant_id", tenantId);
    }
    return await q.first();
}

async function listAll(): Promise<SgVendor[]> {
    return (await SgVendor.query().get()).all();
}

async function list(options: VendorListOptions, scope?: TenantScope) {
    const dbQuery = SgVendor.query().orderBy("last_called_at", "desc").orderBy("id", "desc");

    if (scope) {
        dbQuery.where("tenant_id", scope.tenantId);
    }

    if (options.type) {
        dbQuery.where("type", options.type);
    }

    if (options.keyword) {
        dbQuery.where("name", "like", `%${options.keyword}%`);
    }

    const total = Number(await dbQuery.clone().count() || 0);
    const vendors = await dbQuery.limit(options.pageSize).offset(options.offset).get();
    const vendorList = vendors.all();

    // 每页 vendor 的模型数聚合（单条 GROUP BY 查询）
    const modelCounts: Record<number, number> = {};
    const vendorIds = vendorList.map(v => v.id);
    if (vendorIds.length > 0) {
        const knex = ormService.getKnex();
        const rows: { vendor_id: number; cnt: number }[] = await knex("vendor_model")
            .select(["vendor_id", knex.raw("count(*) as cnt")])
            .whereIn("vendor_id", vendorIds)
            .groupBy("vendor_id");
        rows.forEach(row => {
            modelCounts[Number(row.vendor_id)] = Number(row.cnt);
        });
    }

    return {
        list: vendorList,
        total,
        modelCounts,
    };
}

async function getByIds(ids: number[], tenantId?: number): Promise<SgVendor[]> {
    if (ids.length === 0) {
        return [];
    }
    const q = SgVendor.query().whereIn("id", ids);
    if (tenantId !== undefined) {
        q.where("tenant_id", tenantId);
    }
    return (await q.get()).all();
}

async function create(vendor: SgVendor): Promise<SgVendor> {
    await vendor.save();
    return vendor;
}

async function update(vendorId: number, updateData: Record<string, any>, tenantId?: number): Promise<SgVendor | null> {
    const q = SgVendor.query();
    if (tenantId !== undefined) {
        q.where("tenant_id", tenantId);
    }
    const affected = await q.where("id", vendorId).update(updateData);
    if (affected === 0) {
        return null;
    }
    return await SgVendor.query().find(vendorId);
}

// 供应商资料和模型选择一次保存；D1 不支持 Knex transaction，使用当前请求的 batch。
async function saveWithModels(vendor: SgVendor, modelIds: string[], db?: D1Database): Promise<SgVendor> {
    const knex = ormService.getKnex();
    const now = new Date().toISOString().slice(0, 19).replace("T", " ");
    const data = {
        type: vendor.type,
        name: vendor.name,
        token: vendor.token,
        urls: JSON.stringify(vendor.urls),
        config: JSON.stringify(vendor.config),
        tenant_id: vendor.tenant_id,
        updated_at: now,
    };
    let vendorId = vendor.id;

    if (ormService.isWorker) {
        if (!db) throw new Error("D1 binding is required for saving vendor models");
        const write = vendorId
            ? knex("vendor").where({ id: vendorId, tenant_id: vendor.tenant_id }).update(data)
            : knex("vendor").insert({ ...data, created_at: now });
        const sql = write.returning("id").toSQL();
        const statements = [db.prepare(sql.sql).bind(...sql.bindings)];
        if (vendorId) {
            statements.push(db.prepare(
                "DELETE FROM vendor_model WHERE vendor_id = ? AND model_id NOT IN (SELECT value FROM json_each(?)) AND EXISTS (SELECT 1 FROM vendor WHERE id = ? AND tenant_id = ?)",
            ).bind(vendorId, JSON.stringify(modelIds), vendorId, vendor.tenant_id));
            statements.push(db.prepare(
                "INSERT INTO vendor_model (vendor_id, model_id) SELECT ?, value FROM json_each(?) WHERE EXISTS (SELECT 1 FROM vendor WHERE id = ? AND tenant_id = ?) AND NOT EXISTS (SELECT 1 FROM vendor_model WHERE vendor_id = ? AND model_id = value)",
            ).bind(vendorId, JSON.stringify(modelIds), vendorId, vendor.tenant_id, vendorId));
        } else if (modelIds.length > 0) {
            // 在第一条 INSERT 之后固定新 vendor 的 rowid，不能在插入子表过程中反复读取 last_insert_rowid()。
            statements.push(db.prepare(
                "WITH created_vendor AS MATERIALIZED (SELECT last_insert_rowid() AS id) INSERT INTO vendor_model (vendor_id, model_id) SELECT created_vendor.id, value FROM created_vendor, json_each(?)",
            ).bind(JSON.stringify(modelIds)));
        }
        const results = await db.batch<{ id: number }>(statements);
        vendorId = Number(results[0].results[0]?.id);
    } else {
        await knex.transaction(async (transaction: any) => {
            if (vendorId) {
                await transaction("vendor").where({ id: vendorId, tenant_id: vendor.tenant_id }).update(data);
            } else {
                [vendorId] = await transaction("vendor").insert({ ...data, created_at: now });
            }
            await vendorModelManager.syncByVendor(Number(vendorId), modelIds, transaction);
        });
    }
    const saved = await findById(Number(vendorId));
    if (!saved) throw new Error("Vendor not found after save");
    return saved;
}


async function markCalled(vendorId: number, calledAt: number): Promise<void> {
    await SgVendor.query().where("id", vendorId)
        .whereRaw("(last_called_at IS NULL OR last_called_at < ?)", [calledAt])
        .update({ last_called_at: calledAt });
}


async function count(): Promise<number> {
    return Number(await SgVendor.query().count() || 0);
}

async function countByTenant(tenantId: number): Promise<number> {
    return Number(await SgVendor.query().where("tenant_id", tenantId).count() || 0);
}


async function deleteById(vendorId: number, tenantId?: number): Promise<boolean> {
    const q = SgVendor.query();
    if (tenantId !== undefined) {
        q.where("tenant_id", tenantId);
    }
    const vendor = await q.where("id", vendorId).first();
    if (!vendor) {
        return false;
    }

    await SgVendor.query().where("id", vendorId).delete();
    return true;
}

export default {
    findById,
    findByIdInTenant,
    findByName,
    listAll,
    list,
    getByIds,
    create,
    update,
    saveWithModels,
    markCalled,
    count,
    countByTenant,
    deleteById,
};
