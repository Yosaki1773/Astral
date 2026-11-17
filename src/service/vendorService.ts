import { SgVendor, SgVendorConfig } from "../model/sgVendor";
import { ApiFormat, VendorAuthMode } from "../constants";
import customError from "../customError";
import vendorManager from "../manager/vendorManager";
import vendorModelManager from "../manager/vendorModelManager";
import modelManager from "../manager/modelManager";
import fetchUtil from "../util/fetchUtil";
import ormService from "./ormService";

interface VendorWriteData {
    type?: string;
    name?: string;
    token?: string;
    urls?: Record<string, string>;
    config?: Record<string, any>;
    model_ids?: unknown;
}

function normalizeModelIds(value: unknown): string[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.some(id => typeof id !== "string" || !id.trim())) {
        throw new customError.AppError("model_ids must be an array of non-empty strings", 400);
    }
    return [...new Set(value.map(id => id.trim()))];
}


async function createVendor(data: VendorWriteData, tenantId: number, db?: D1Database): Promise<SgVendor> {
    const modelIds = normalizeModelIds(data.model_ids);
    const vendor = new SgVendor({
        type: data.type, name: data.name, token: data.token,
        urls: data.urls ?? {}, config: new SgVendorConfig(data.config), tenant_id: tenantId,
    });
    if (!vendor.type || !vendor.name || !vendor.token) throw new customError.AppError("Missing required fields");
    if (await vendorManager.findByName(vendor.name, tenantId)) {
        throw new customError.AppError("A vendor with this name already exists", 409);
    }
    validateVendorConfig(data.config);
    return modelIds === undefined
        ? vendorManager.create(vendor)
        : vendorManager.saveWithModels(vendor, modelIds, db);
}


async function recordCall(vendorId: number, calledAt: number): Promise<void> {
    try {
        await vendorManager.markCalled(vendorId, calledAt);
    } catch (error) {
        console.warn(`[vendor] Failed to update last call for ${vendorId}:`, error);
    }
}


/**
 * 校验供应商配置：代理类型与 URL scheme 必须匹配；自定义 UA 开启时限制长度
 */
function validateVendorConfig(config?: Record<string, any>): void {
    const proxy = config?.proxy;
    if (proxy && proxy.url) {
        const url = proxy.url as string;
        const isSocks = url.startsWith("socks");

        if (proxy.type === "http" && isSocks) {
            throw new customError.AppError("代理类型为 HTTP，但 URL 使用了 SOCKS 协议");
        }
        if (proxy.type === "socks5" && !isSocks) {
            throw new customError.AppError("代理类型为 SOCKS5，但 URL 不是 SOCKS 协议");
        }
    }

    if (config?.user_agent_enabled) {
        const ua = typeof config.user_agent === "string" ? config.user_agent.trim() : "";
        if (ua.length > 512) {
            throw new customError.AppError("User-Agent 过长（最多 512 字符）", 400);
        }
    }
}


async function updateVendor(
    vendorId: number,
    data: VendorWriteData,
    tenantId?: number,
    db?: D1Database,
): Promise<SgVendor | null> {
    const modelIds = normalizeModelIds(data.model_ids);
    validateVendorConfig(data.config);

    const vendor = tenantId !== undefined
        ? await vendorManager.findByIdInTenant(vendorId, tenantId)
        : await vendorManager.findById(vendorId);

    if (!vendor) {
        return null;
    }

    // 供应商名租户内唯一查重（创建 / 更新）
    if (data.name !== undefined && data.name !== vendor.name) {
        const dup = await vendorManager.findByName(data.name, tenantId);
        if (dup && dup.id !== vendorId) {
            throw new customError.AppError("A vendor with this name already exists", 409);
        }
    }

    const updateData: any = {
        type: data.type ?? vendor.type,
        name: data.name ?? vendor.name,
        token: data.token ?? vendor.token,
    };

    // query().update() 是裸 SQL 拼接，不走 casts，对象类型字段需手动序列化
    if (data.urls !== undefined) {
        updateData.urls = JSON.stringify(data.urls);
    }

    if (data.config !== undefined) {
        updateData.config = JSON.stringify(data.config);
    }

    if (modelIds !== undefined) {
        vendor.type = updateData.type;
        vendor.name = updateData.name;
        vendor.token = updateData.token;
        if (data.urls !== undefined) vendor.urls = data.urls;
        if (data.config !== undefined) vendor.config = new SgVendorConfig(data.config);
        return vendorManager.saveWithModels(vendor, modelIds, db);
    }
    return await vendorManager.update(vendorId, updateData, tenantId);
}

async function findVendorByUrl(gatewayUrl: string, protocol: ApiFormat): Promise<number | null> {
    if (!gatewayUrl) return null;

    const vendors = await vendorManager.listAll();
    for (const vendor of vendors) {
        const mergedUrls = vendor.getMergedUrls();
        const vendorUrl = mergedUrls[protocol];

        if (vendorUrl && gatewayUrl.startsWith(vendorUrl)) {
            return Number(vendor.id);
        }
    }

    return null;
}


const NON_LLM_PATTERNS = [
    /embedding/i,
    /rerank/i,
    /\btts\b/i,
    /text-to-speech/i,
    /speech-to-text/i,
    /whisper/i,
    /dall-e/i,
    /stable-diffusion/i,
    /image/i,
    /image2video/i,
    /video-gen/i,
    /video/i,
    /ocr/i,
    /livetranslate/i,
    /realtime-asr/i,
    /moderation/i,
    /^wanx/i,
    /^wan\d/i,
    /^cosyvoice/i,
    /^sensevoice/i,
    /^sambert/i,
    /^paraformer/i,
];

function isLlmModel(modelId: string): boolean {
    return !NON_LLM_PATTERNS.some(pattern => pattern.test(modelId));
}


/**
 * 从上游 API 获取模型列表
 */
export async function fetchUpstreamModels(vendor: SgVendor): Promise<string[]> {
    const format = [ApiFormat.OPENAI, ApiFormat.RESPONSES, ApiFormat.ANTHROPIC]
        .find(format => vendor.getUrlByFormat(format) !== null);
    if (!format) {
        throw new customError.AppError("vendor does not have url for openai, responses or anthropic format", 400);
    }
    const endpointUrl = vendor.getUrlByFormat(format)!;
    const modelsUrl = endpointUrl.replace(/\/(chat\/completions|responses|messages)(?=\?|$)/, "/models");
    const requestHeaders: Record<string, string> = { "Content-Type": "application/json" };
    if (format === ApiFormat.ANTHROPIC && vendor.config.auth_mode === VendorAuthMode.API_KEY) {
        requestHeaders["x-api-key"] = vendor.token;
        requestHeaders["anthropic-version"] = "2023-06-01";
    } else {
        requestHeaders.Authorization = vendor.token.startsWith("Bearer ") ? vendor.token : `Bearer ${vendor.token}`;
    }
    const vendorUserAgent = vendor.config.getUserAgent();
    if (vendorUserAgent) requestHeaders["User-Agent"] = vendorUserAgent;

    try {
        const dispatcher = ormService.isNode ? await fetchUtil.getDispatcher(vendor.config) : undefined;
        const response = await fetch(modelsUrl, {
            method: "GET",
            headers: requestHeaders,
            signal: AbortSignal.timeout(30000),
            ...(dispatcher ? { dispatcher } as any : {}),
        });

        if (!response.ok) {
            const text = await response.text();
            throw new customError.AppError(
                `Upstream returned ${response.status}: ${text}`,
                502,
            );
        }

        const data: any = await response.json();

        const models: string[] = Array.isArray(data?.data)
            ? [...new Set<string>(data.data.map((m: any) => m.id).filter((id: unknown) => typeof id === "string" && id.trim()).filter(isLlmModel))]
            : [];

        return models;
    } catch (err: any) {
        if (err.statusCode) throw err;
        throw new customError.AppError(`Failed to fetch models: ${err.message}`, 502);
    }
}


async function getModelSummaries(vendorIds: number[], tenantId: number) {
    if (vendorIds.length === 0) return {};
    const [vendorModels, systemModels] = await Promise.all([
        vendorModelManager.listByVendors(vendorIds),
        modelManager.listByTenant(tenantId),
    ]);
    const references = new Map<string, Set<string>>();
    const vendors = new Set(vendorIds);
    for (const model of systemModels) {
        if (!model.name) continue;
        for (const upstream of model.getRoutingConfig().upstreams) {
            if (!vendors.has(upstream.vendor_id)) continue;
            const key = upstream.vendor_model_id !== undefined
                ? `${upstream.vendor_id}:id:${upstream.vendor_model_id}`
                : `${upstream.vendor_id}:name:${model.name}`;
            if (!references.has(key)) references.set(key, new Set());
            references.get(key)!.add(model.name);
        }
    }
    const result: Record<number, Array<{ id: number; model_id: string; system_model_names: string[] }>> = {};
    for (const vendorModel of vendorModels) {
        const names = new Set([
            ...(references.get(`${vendorModel.vendor_id}:id:${vendorModel.id}`) ?? []),
            ...(references.get(`${vendorModel.vendor_id}:name:${vendorModel.model_id}`) ?? []),
        ]);
        (result[vendorModel.vendor_id] ??= []).push({
            id: vendorModel.id, model_id: vendorModel.model_id, system_model_names: [...names],
        });
    }
    return result;
}


export default {
    createVendor,
    updateVendor,
    recordCall,
    getModelSummaries,
    normalizeModelIds,
    findVendorByUrl,
    fetchUpstreamModels,
    validateVendorConfig,
};
