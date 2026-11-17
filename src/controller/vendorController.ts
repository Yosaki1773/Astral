import { Context } from "hono";
import { SgVendor } from "../model/sgVendor";
import vendorManager from "../manager/vendorManager";
import vendorService from "../service/vendorService";
import vendorDefaultUrls from "../util/vendorDefaultUrlsUtil";
import vendorTestService from "../service/vendorTestService";
import modelManager from "../manager/modelManager";
import customError from "../customError";
import { createListResponse, parsePaginationQuery } from "../util/paginationUtil";


/**
 * Format vendor for API response (parse URLs using model method)
 */
function formatVendor(vendor: SgVendor, modelCount = 0) {
    return {
        id: vendor.id,
        type: vendor.type,
        name: vendor.name,
        token: vendor.token,
        urls: vendor.urls,
        config: vendor.config,
        model_count: modelCount,
        last_called_at: vendor.last_called_at ?? null,
        created_at: vendor.created_at,
        updated_at: vendor.updated_at,
    };
}


async function listVendors(c: Context) {
    const scope = c.get("tenantScope")!;
    const query = c.req.query();
    const { pageSize, offset } = parsePaginationQuery(query);

    const { list: vendors, total, modelCounts } = await vendorManager.list({
        type: query.type,
        keyword: query.keyword,
        pageSize,
        offset,
    }, scope);

    const models = await vendorService.getModelSummaries(vendors.map(v => v.id), scope.tenantId);
    const formattedVendors = vendors.map(v => ({
        ...formatVendor(v, modelCounts[v.id] ?? 0),
        models: models[v.id] ?? [],
    }));
    return c.json(createListResponse(formattedVendors, total));
}


async function getVendor(c: Context) {
    const scope = c.get("tenantScope")!;
    const id = c.req.param("id");
    const vendorId = parseInt(id, 10);

    if (isNaN(vendorId)) {
        throw new customError.AppError("Invalid ID format");
    }

    const vendor = await vendorManager.findByIdInTenant(vendorId, scope.tenantId);

    if (!vendor) {
        throw new customError.NotFoundError("Vendor not found");
    }

    return c.json(formatVendor(vendor));
}

async function getVendorsByIds(c: Context) {
    const scope = c.get("tenantScope")!;
    const body = await c.req.json();
    const ids = body.ids;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return c.json([]);
    }

    const idList = ids.map(id => parseInt(String(id), 10)).filter(id => !isNaN(id));
    if (idList.length === 0) {
        return c.json([]);
    }

    const vendors = await vendorManager.getByIds(idList, scope.tenantId);
    const formattedVendors = vendors.map(formatVendor);
    return c.json(formattedVendors);
}


async function createVendor(c: Context) {
    const scope = c.get("tenantScope")!;
    const body = await c.req.json();
    const instance = await vendorService.createVendor(body, scope.tenantId, c.env?.DB);
    return c.json(formatVendor(instance));
}


async function updateVendor(c: Context) {
    const scope = c.get("tenantScope")!;
    const id = c.req.param("id");
    const vendorId = parseInt(id, 10);

    if (isNaN(vendorId)) {
        throw new customError.AppError("Invalid ID format");
    }

    const body = await c.req.json();
    const { type, name, token, urls, config, model_ids } = body;

    const updatedVendor = await vendorService.updateVendor(vendorId, {
        type,
        name,
        token,
        urls,
        config,
        model_ids,
    }, scope.tenantId, c.env?.DB);

    if (!updatedVendor) {
        throw new customError.NotFoundError("Vendor not found");
    }

    return c.json(formatVendor(updatedVendor));
}


async function deleteVendor(c: Context) {
    const scope = c.get("tenantScope")!;
    const id = c.req.param("id");
    const vendorId = parseInt(id, 10);

    if (isNaN(vendorId)) {
        throw new customError.AppError("Invalid ID format");
    }

    const vendor = await vendorManager.findByIdInTenant(vendorId, scope.tenantId);

    if (!vendor) {
        throw new customError.NotFoundError("Vendor not found");
    }

    if (await modelManager.hasModelsUsingVendor(vendorId, scope.tenantId)) {
        throw new customError.AppError("Cannot delete vendor with associated models");
    }

    const deleted = await vendorManager.deleteById(vendorId, scope.tenantId);
    if (!deleted) {
        throw new customError.NotFoundError("Vendor not found");
    }

    return c.json({ success: true });
}

async function testVendor(c: Context) {
    const scope = c.get("tenantScope")!;
    const id = c.req.param("id");
    const vendorId = parseInt(id, 10);

    if (isNaN(vendorId)) {
        throw new customError.AppError("Invalid ID format");
    }

    const vendor = await vendorManager.findByIdInTenant(vendorId, scope.tenantId);
    if (!vendor) {
        throw new customError.NotFoundError("Vendor not found");
    }

    const bodyJson = await c.req.json().catch(() => ({}));
    const result = await vendorTestService.testVendorConnectivity(vendor, {
        format: bodyJson.format,
        model: bodyJson.model,
        auto_convert: bodyJson.auto_convert,
    });

    return c.json(result);
}

async function getPresetUrls(c: Context) {
    return c.json(vendorDefaultUrls.getAllUrls());
}


export default {
    listVendors,
    getVendor,
    getVendorsByIds,
    createVendor,
    updateVendor,
    deleteVendor,
    testVendor,
    getPresetUrls,
};
