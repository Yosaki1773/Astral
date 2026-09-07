import { SgRecord } from "../model/sgRecord";
import { SgRecordStatus, ApiFormat, ConfigKey } from "../constants";
import recordManager, { type RecordUpdateData } from "../manager/recordManager";
import objectStorageService from "./objectStorageService";
import configService from "./configService";

interface RecordPayload {
    request: string | null;
    response: string | null;
}

const RECORD_PAYLOAD_PREFIX = "record/";

function isLogEnabled(): boolean {
    return process.env.RECORD_LOG_ENABLED === "true";
}

async function isPayloadRecordingEnabled(): Promise<boolean> {
    return (await configService.getConfig(ConfigKey.RECORD_PAYLOAD_ENABLED)).getBoolean();
}

function storageKey(recordId: number): string {
    return `${RECORD_PAYLOAD_PREFIX}${recordId}`;
}

async function readPayload(recordId: number): Promise<RecordPayload> {
    const raw = await objectStorageService.getText(storageKey(recordId));
    if (!raw) {
        return { request: null, response: null };
    }
    try {
        const parsed = JSON.parse(raw) as Partial<RecordPayload>;
        return {
            request: parsed.request ?? null,
            response: parsed.response ?? null,
        };
    } catch (e) {
        console.error(`[RecordService] Failed to parse stored payload for record ${recordId}:`, e);
        return { request: null, response: null };
    }
}

async function writePayload(recordId: number, payload: RecordPayload): Promise<void> {
    await objectStorageService.putText(storageKey(recordId), JSON.stringify(payload));
}

async function attachPayload(record: SgRecord): Promise<SgRecord> {
    const payload = await readPayload(Number(record.id));
    record.request_data = payload.request;
    record.response_data = payload.response;
    return record;
}

async function clearPayloads(): Promise<number> {
    return objectStorageService.deleteByPrefix(RECORD_PAYLOAD_PREFIX);
}

const RECORD_ID_FROM_KEY = /^record\/(\d+)$/;

/**
 * 按关键字扫描对象存储中所有 record 载荷，返回请求或响应字段中含子串的 record id 集合。
 * 大小写不敏感；只在 keyword 非空时调用。
 *
 * 注意：当前实现是 O(N) 全表扫描 + 每个对象 BLOB 解码，规模大时性能差。
 * 后续可优化方向：在 record 表加预提取的消息内容列 + FTS 索引 / 改用 R2 批量读取。
 */
async function findMatchingRecordIds(keyword: string): Promise<number[]> {
    const needle = keyword.toLowerCase();
    if (!needle) {
        return [];
    }

    const keys = await objectStorageService.listKeysByPrefix(RECORD_PAYLOAD_PREFIX);
    const matched: number[] = [];

    for (const key of keys) {
        const match = RECORD_ID_FROM_KEY.exec(key);
        if (!match) {
            continue;
        }
        const recordId = parseInt(match[1], 10);
        if (Number.isNaN(recordId)) {
            continue;
        }

        const payload = await readPayload(recordId);
        const haystackRequest = payload.request?.toLowerCase() ?? "";
        const haystackResponse = payload.response?.toLowerCase() ?? "";
        if (haystackRequest.includes(needle) || haystackResponse.includes(needle)) {
            matched.push(recordId);
        }
    }

    return matched;
}

// 一条用户请求 = 一条 record：进入路由循环前创建，此时还不知道命中的上游
// 上游信息（vendor_id / vendor_model_name / upstream_format）由后续每次上游尝试 update 覆盖
async function create(
    userId: number,
    modelId: number | null,
    requestData: string | null,
    clientFormat: string | null = null,
) {
    if (isLogEnabled()) {
        console.log(`[RecordService] Creating record: user=${userId}, model=${modelId}`);
        if (requestData) {
            console.log(`[RecordService] Request data: ${requestData}`);
        }
    }

    const record = await recordManager.create({
        user_id: userId,
        model_id: modelId,
        vendor_id: null,
        vendor_model_name: null,
        status: SgRecordStatus.INIT,
        client_format: clientFormat,
        upstream_format: null,
        first_token_latency: null,
        start_at: new Date(),
        end_at: null,
        cost: 0,
    });

    if (await isPayloadRecordingEnabled()) {
        await writePayload(Number(record.id), {
            request: requestData ?? null,
            response: null,
        });
    }

    return record;
}

async function update(recordId: number, data: RecordUpdateData) {
    if (isLogEnabled()) {
        console.log(`[RecordService] Updating record ${recordId}:`, JSON.stringify(data, null, 2));
    }

    // response_data 存在对象存储，写入表前先落存储
    if (Object.prototype.hasOwnProperty.call(data, "response_data")) {
        if (await isPayloadRecordingEnabled()) {
            const payload = await readPayload(recordId);
            payload.response = (data as any).response_data ?? null;
            await writePayload(recordId, payload);
        }
    }

    return recordManager.update(recordId, data);
}

async function latest(limit: number = 10, summaryOnly: boolean = false) {
    const records = await recordManager.latest(limit, summaryOnly);

    if (!summaryOnly) {
        await Promise.all(records.map((r: SgRecord) => attachPayload(r)));
    }
    return records;
}

async function recordFailedRequest(
    userId: number,
    modelName: string | null,
    body: string,
    clientFormat: ApiFormat,
    failedCode: string,
    modelId: number | null = null
) {
    try {
        const record = await create(
            userId,
            modelId,
            body,
            clientFormat
        );
        await update(record.id, {
            status: SgRecordStatus.FAILED,
            failed_code: failedCode,
            end_at: new Date(),
        });
    } catch (e) {
        console.error("Failed to write failed record:", e);
    }
}

export default {
    create,
    update,
    latest,
    recordFailedRequest,
    attachPayload,
    clearPayloads,
    findMatchingRecordIds,
};
