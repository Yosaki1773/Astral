import type { BaseEntity, TableQuery } from './index';

export type VendorType = 'openai' | 'anthropic' | 'google' | 'aliyun' | 'aliyun_coding' | 'volcengine_coding' | 'deepseek' | 'mimo' | 'mimo_token_plan' | 'opencode_go' | 'other';

export type VendorAuthMode = 'api_key' | 'bearer_token';

export type VendorProxyType = 'http' | 'socks5';

export interface VendorProxyConfig {
    type: VendorProxyType;
    url: string;
}

export interface VendorUrls {
    [key: string]: string;
}

export interface VendorConfig {
    auth_mode?: VendorAuthMode;
    skip_tls_verify?: boolean;
    /** 是否开启自定义上游 User-Agent；false/缺省时网关不注入 UA 头 */
    user_agent_enabled?: boolean;
    /** 自定义 User-Agent 值，仅开启时生效；空白时使用默认 claude-cli 值 */
    user_agent?: string;
    proxy?: VendorProxyConfig | null;
    [key: string]: any;
}

export interface Vendor extends BaseEntity {
    type: VendorType;
    name: string;
    token: string;
    urls: VendorUrls;
    config: VendorConfig;
    model_count: number;
}

export interface CreateVendorRequest {
    type: VendorType;
    name: string;
    token: string;
    urls?: VendorUrls;
    config?: VendorConfig;
}

export interface UpdateVendorRequest {
    type?: VendorType;
    name?: string;
    token?: string;
    urls?: VendorUrls;
    config?: VendorConfig;
}

export interface VendorQuery extends TableQuery {
    type?: VendorType;
}

export interface VendorModel {
    id: number;
    vendor_id: number;
    model_id: string;
    allowed_formats: string[] | null;
    created_at: string;
    updated_at: string;
}
