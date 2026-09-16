// 无时区标记的 'YYYY-MM-DD HH:mm:ss'（毫秒可选），即 datetime cast 写入 record 时间列的格式
const NAIVE_DATETIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/;


/**
 * 把 record 时间字段归一化成带时区标记的 ISO 串，消除跨环境解析歧义。
 *
 * 背景：start_at 经模型 datetime cast 写入的是「服务器本地时区」的裸文本（如 '2026-08-29 20:53:33'），
 * 本身不带时区标记；而 end_at 走裸 query update，在 Worker 下被 D1 补丁转成带 Z 的 ISO 串。
 * 浏览器解析裸文本时会套用访问者的本地时区，一旦服务器时区（Cloudflare Workers 为 UTC）与
 * 浏览器时区（如 +08:00）不一致，该字段就会被整体平移，导致「总耗时」多出时区偏移量。
 * 这里按写入时所用时区（即服务器本地时区）还原裸文本，使输出统一带时区标记。
 */
function toIsoTimestamp(value: unknown): string | number | null {
    if (value === null || value === undefined) {
        return null;
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    if (typeof value === "string") {
        const matched = NAIVE_DATETIME_PATTERN.exec(value);
        if (matched) {
            const year = Number(matched[1]);
            const month = Number(matched[2]);
            const day = Number(matched[3]);
            const hour = Number(matched[4]);
            const minute = Number(matched[5]);
            const second = Number(matched[6]);
            const milliseconds = matched[7] ? Number(matched[7].padEnd(3, "0")) : 0;
            // 多参数 Date 构造按本地时区解释，与 datetime cast 写入时所用时区一致
            const parsed = new Date(year, month - 1, day, hour, minute, second, milliseconds);
            // 非法日期（如 2026-13-45）原样返回，避免 toISOString 抛异常影响整个接口。
            // 越界分量不会构造出 NaN 而是进位成另一个合法日期，因此用「回读分量与输入一致」判定
            if (
                parsed.getFullYear() === year &&
                parsed.getMonth() === month - 1 &&
                parsed.getDate() === day &&
                parsed.getHours() === hour &&
                parsed.getMinutes() === minute &&
                parsed.getSeconds() === second
            ) {
                return parsed.toISOString();
            }
        }
    }

    // 其余情况（epoch 毫秒数、已带时区标记的 ISO 串等）自身无歧义，原样返回
    return value as string | number;
}


export default {
    toIsoTimestamp,
};
