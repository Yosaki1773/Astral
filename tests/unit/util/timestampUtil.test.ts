import { describe, it, expect } from "vitest";
import timestampUtil from "../../../src/util/timestampUtil";

/** 按服务器本地时区把 Date 格式化成 'YYYY-MM-DD HH:mm:ss'，复刻模型 datetime cast 的写入格式 */
function toLocalNaive(date: Date): string {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

/** 模拟浏览器解析：带时区标记的按原样，裸文本按浏览器本地时区（这里固定 +08:00）解释 */
function parseAsBrowser(timestamp: string): number {
    return /Z$|[+-]\d{2}:?\d{2}$/.test(timestamp)
        ? Date.parse(timestamp)
        : Date.parse(timestamp.replace(" ", "T") + "+08:00");
}

describe("timestampUtil.toIsoTimestamp", () => {
    it("对 null / undefined 返回 null", () => {
        expect(timestampUtil.toIsoTimestamp(null)).toBeNull();
        expect(timestampUtil.toIsoTimestamp(undefined)).toBeNull();
    });

    it("Date 实例直接输出 ISO", () => {
        expect(timestampUtil.toIsoTimestamp(new Date("2026-08-29T20:53:33.000Z")))
            .toBe("2026-08-29T20:53:33.000Z");
    });

    it("已带时区标记的 ISO 串原样返回（end_at 在 Worker 下的实际形态）", () => {
        expect(timestampUtil.toIsoTimestamp("2026-08-29T20:53:35.625Z"))
            .toBe("2026-08-29T20:53:35.625Z");
    });

    it("epoch 毫秒数原样返回（end_at 在 Node 模式下的实际形态）", () => {
        expect(timestampUtil.toIsoTimestamp(1789440583493)).toBe(1789440583493);
    });

    it("无时区标记的文本按服务器本地时区还原，与写入前的时刻一致", () => {
        const instant = new Date("2026-08-29T20:53:33.000Z");
        expect(timestampUtil.toIsoTimestamp(toLocalNaive(instant))).toBe(instant.toISOString());
    });

    it("无时区标记的文本支持带毫秒", () => {
        const instant = new Date("2026-08-29T20:53:35.625Z");
        const naive = `${toLocalNaive(instant)}.625`;
        expect(timestampUtil.toIsoTimestamp(naive)).toBe(instant.toISOString());
    });

    it("非法日期原样返回，不抛异常", () => {
        expect(timestampUtil.toIsoTimestamp("2026-13-45 99:99:99")).toBe("2026-13-45 99:99:99");
    });

    // 回归用例：Worker(UTC) 写入 start_at 裸文本、end_at 带 Z，
    // 修复前浏览器(+08:00)把 start_at 多算 8 小时，总耗时凭空多出 28800000ms
    it("浏览器在任意时区解析时，总耗时都不含时区偏移", () => {
        const start = new Date("2026-08-29T20:53:33.000Z");
        const end = new Date("2026-08-29T20:53:35.625Z");

        const startAt = timestampUtil.toIsoTimestamp(toLocalNaive(start)) as string;
        const endAt = timestampUtil.toIsoTimestamp("2026-08-29T20:53:35.625Z") as string;

        expect(parseAsBrowser(endAt) - parseAsBrowser(startAt)).toBe(2625);
        expect(end.getTime() - start.getTime()).toBe(2625);
    });
});
