import { SgVendor } from "../model/sgVendor";
import { ApiFormat } from "../constants";
import customError from "../customError";
import vendorManager from "../manager/vendorManager";


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
    data: { type?: string; name?: string; token?: string; urls?: Record<string, string>; config?: Record<string, any> },
    tenantId?: number,
): Promise<SgVendor | null> {
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

    return await vendorManager.update(vendorId, updateData, tenantId);
}

async function findVendorByUrl(gatewayUrl: string, protocol: ApiFormat): Promise<number | null> {
    if (!gatewayUrl) return null;

    const vendors = await vendorManager.listAll();
    for (const vendor of vendors) {
        const mergedUrls = vendor.getMergedUrls();
        let vendorUrl: string | undefined;

        if (protocol === ApiFormat.RESPONSES) {
            vendorUrl = mergedUrls[ApiFormat.RESPONSES] || mergedUrls[ApiFormat.OPENAI];
        } else {
            vendorUrl = mergedUrls[protocol];
        }

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
    let baseUrl: string | null = null;
    const openaiUrl = vendor.getUrlByFormat(ApiFormat.OPENAI);
    if (openaiUrl !== null) {
        baseUrl = openaiUrl.replace(/\/chat\/completions$/, "");
    } else {
        const responsesUrl = vendor.getUrlByFormat(ApiFormat.RESPONSES);
        if (responsesUrl !== null) {
            baseUrl = responsesUrl.replace(/\/responses$/, "");
        }
    }

    if (baseUrl === null) {
        throw new customError.AppError("vendor does not have url for openai or responses format", 400);
    }
    const modelsUrl = `${baseUrl}/models`;

    const token = vendor.token;
    const authHeader = token.startsWith("Bearer ") ? token : `Bearer ${token}`;

    // 获取模型列表与网关请求保持一致的 User-Agent 口径
    const vendorUserAgent = vendor.config.getUserAgent();
    const requestHeaders: Record<string, string> = {
        Authorization: authHeader,
        "Content-Type": "application/json",
    };
    if (vendorUserAgent) {
        requestHeaders["User-Agent"] = vendorUserAgent;
    }

    try {
        const response = await fetch(modelsUrl, {
            method: "GET",
            headers: requestHeaders,
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
            ? data.data.map((m: any) => m.id).filter(Boolean).filter(isLlmModel)
            : [];

        return models;
    } catch (err: any) {
        if (err.statusCode) throw err;
        throw new customError.AppError(`Failed to fetch models: ${err.message}`, 502);
    }
}


export default {
    updateVendor,
    findVendorByUrl,
    fetchUpstreamModels,
    validateVendorConfig,
};
