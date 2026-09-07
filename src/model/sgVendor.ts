import { Model } from "sutando";
import { CastsAttributes } from "sutando";
import { inspect, InspectOptions } from "util";
import { ApiFormat, VendorAuthMode } from "../constants";
import vendorDefaultUrls from "../util/vendorDefaultUrlsUtil";


/**
 * 供应商配置对象，同时作为 Sutando 自定义 cast（Sutando 通过 instanceof CastsAttributes 识别）。
 * vendor.config 的类型即为此类，读写一致。
 */
// @ts-expect-error Sutando .d.ts 声明 static get/set() 无参，运行时传 4 个实参
class SgVendorConfig extends CastsAttributes {
    /** 认证模式，未配置时默认为 bearer_token */
    auth_mode: VendorAuthMode = VendorAuthMode.BEARER_TOKEN;

    /** 是否跳过 TLS 证书验证（用于自签证书等内网环境） */
    skip_tls_verify: boolean = false;

    /** 代理配置 */
    proxy?: { type: "http" | "socks5"; url: string } | null;

    constructor(data?: Partial<SgVendorConfig>) {
        super();
        if (data) {
            if (data.auth_mode !== undefined) this.auth_mode = data.auth_mode;
            if (data.skip_tls_verify !== undefined) this.skip_tls_verify = data.skip_tls_verify;
            if (data.proxy !== undefined) this.proxy = data.proxy;
        }
    }

    /** API 响应序列化（JSON.stringify 自动调用） */
    toJSON() {
        const result: Record<string, any> = {
            auth_mode: this.auth_mode,
            skip_tls_verify: this.skip_tls_verify,
        };
        if (this.proxy != null) result.proxy = this.proxy;
        return result;
    }

    // ---- Sutando custom cast ----

    /** DB string → SgVendorConfig 实例 */
    static get(self: SgVendor, key: string, value: string): SgVendorConfig {
        let parsed: Record<string, any> = {};
        try { parsed = value ? JSON.parse(value) : {}; } catch {}
        return new SgVendorConfig(parsed);
    }

    // 创建时收到纯对象，读改保存时收到 SgVendorConfig 实例，两者都需支持
    static set(self: SgVendor, key: string, value: SgVendorConfig | Record<string, any>): string {
        return JSON.stringify(value instanceof SgVendorConfig ? value.toJSON() : value);
    }
}

class SgVendor extends Model {
    table = "vendor";

    id!: number;
    type!: string;
    name!: string;
    token!: string;
    urls!: Record<string, string>;
    config!: SgVendorConfig;

    casts = {
        urls: 'json',
        config: SgVendorConfig,
    };

    created_at!: Date;
    updated_at!: Date;

    constructor(attributes: Record<string, unknown> = {}) {
        super();
        this.fill({
            urls: {},
            config: new SgVendorConfig(),
            ...attributes,
        });
    }

    /**
     * Merge preset URLs and DB-stored custom URLs.
     * Custom URLs override presets with the same format key.
     */
    getMergedUrls(): Record<string, string> {
        const presetUrls = vendorDefaultUrls.getAllUrls()[this.type] ?? {};
        const merged = { ...presetUrls, ...this.urls };
        delete merged['label'];
        return merged;
    }

    /**
     * 根据 API 格式获取对应的 URL
     * @param format - API 格式（openai, anthropic, responses）
     * @returns 完整的 URL 字符串；无法解析（缺 URL 或无法派生）时返回 null，由调用方处理
     */
    getUrlByFormat(format: ApiFormat): string | null {
        const urls = this.getMergedUrls();

        if (format === ApiFormat.RESPONSES) {
            // Responses 格式：仅当 urls[RESPONSES] 显式配置时支持；与 ANTHROPIC 分支口径一致，
            // 不再从 OPENAI URL 派生（派生得到的路径不代表上游真正实现了 responses 协议）。
            const responsesUrl = urls[ApiFormat.RESPONSES];
            if (responsesUrl) {
                return responsesUrl.includes("/responses") ? responsesUrl : responsesUrl.replace(/\/$/, "") + "/responses";
            }
            return null;
        }

        if (format === ApiFormat.ANTHROPIC) {
            // Anthropic 格式：使用 urls[ANTHROPIC]
            const anthropicUrl = urls[ApiFormat.ANTHROPIC];
            if (anthropicUrl) {
                return anthropicUrl.includes("/v1/messages") ? anthropicUrl : anthropicUrl.replace(/\/$/, "") + "/v1/messages";
            }
        }

        if (format === ApiFormat.OPENAI) {
            // OpenAI 格式：使用 urls[OPENAI]
            const openaiUrl = urls[ApiFormat.OPENAI];
            if (openaiUrl) {
                return openaiUrl.includes("/chat/completions") ? openaiUrl : openaiUrl.replace(/\/$/, "") + "/chat/completions";
            }
        }

        return null;
    }

    /**
     * 获取当前 vendor 支持的格式列表
     * 口径：vendor.urls（或预设）里显式声明了对应 key 才算支持。
     * 不再做派生推断——许多 OpenAI 兼容服务只实现了 /chat/completions，
     * 若从其 openai URL 派生一个 /responses 路径去打，必然 404。
     * @returns 支持的格式数组
     */
    getSupportedFormats(): ApiFormat[] {
        const formats: ApiFormat[] = [];
        const urls = this.getMergedUrls();

        if (urls[ApiFormat.OPENAI]) {
            formats.push(ApiFormat.OPENAI);
        }
        if (urls[ApiFormat.ANTHROPIC]) {
            formats.push(ApiFormat.ANTHROPIC);
        }
        if (urls[ApiFormat.RESPONSES]) {
            formats.push(ApiFormat.RESPONSES);
        }

        return formats;
    }

    [inspect.custom](depth: number, options: InspectOptions) {
        return JSON.stringify(this.toData(), null, 2);
    }
}

export { SgVendor, SgVendorConfig };
