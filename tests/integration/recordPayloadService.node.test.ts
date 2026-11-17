import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SgRecordStatus, RunMode } from "../../src/constants";
import { SgRecord } from "../../src/model/sgRecord";
import objectStorageService from "../../src/service/objectStorageService";
import ormService from "../../src/service/ormService";
import recordService from "../../src/service/recordService";
import dbHelper from "../helpers/dbHelper";
import ormTestHelper from "../helpers/ormTestHelper";


describe("record payload service integration", () => {
    beforeAll(async () => {
        await ormTestHelper.connectNodeOrm();
    });

    beforeEach(async () => {
        ormService.mode = RunMode.NODE;
        objectStorageService.setR2Bucket(null);
        await dbHelper.truncate();
    });

    it("objectStorageService.deleteByPrefix deletes only record payload keys", async () => {
        await objectStorageService.putText("record/clear-a", "record-a");
        await objectStorageService.putText("record/clear-b", "record-b");
        await objectStorageService.putText("recording/keep-a", "recording-a");
        await objectStorageService.putText("other/keep-b", "other-b");

        const cleared = await objectStorageService.deleteByPrefix("record/");

        expect(cleared).toBe(2);
        expect(await objectStorageService.getText("record/clear-a")).toBeNull();
        expect(await objectStorageService.getText("record/clear-b")).toBeNull();
        expect(await objectStorageService.getText("recording/keep-a")).toBe("recording-a");
        expect(await objectStorageService.getText("other/keep-b")).toBe("other-b");
    });

    describe.each(["request", "response"] as const)("keyword search in %s", (field) => {
        it.each([
            { name: "Unicode escapes", text: String.raw`\u5173\u952e\u5b57`, keyword: "关键字" },
            { name: "escaped quotes", text: String.raw`say \"Hello\"`, keyword: 'say "hello"' },
            { name: "escaped newlines", text: String.raw`first\nsecond`, keyword: "first\nsecond" },
            { name: "escaped backslashes", text: String.raw`C:\\Users\\demo`, keyword: String.raw`C:\Users\demo` },
            { name: "escaped slashes", text: String.raw`https:\/\/example.test\/path`, keyword: "https://example.test/path" },
        ])("matches decoded content containing $name", async ({ text, keyword }) => {
            const body = `{"messages":[{"content":"${text}"}]}`;
            const record = await recordService.create(1, 1, field === "request" ? body : '{"unrelated":true}');
            if (field === "response") {
                await recordService.update(Number(record.id), { response_data: body });
            }
            await recordService.create(1, 1, '{"unrelated":true}');

            await recordService.attachPayload(record);
            expect(JSON.parse(field === "request" ? record.request_data! : record.response_data!)
                .messages[0].content.toLowerCase()).toContain(keyword.toLowerCase());
            expect(await recordService.findMatchingRecordIds(keyword)).toEqual([Number(record.id)]);
        });
    });

    it("keyword search preserves raw JSON and plain-text error matching", async () => {
        const record = await recordService.create(1, 1, '{"messages":[]}');
        await recordService.update(Number(record.id), { response_data: "Upstream connection failed" });
        await recordService.create(1, 1, '{"unrelated":true}');

        expect(await recordService.findMatchingRecordIds('{"messages":')).toEqual([Number(record.id)]);
        expect(await recordService.findMatchingRecordIds("CONNECTION FAILED")).toEqual([Number(record.id)]);
        expect(await recordService.findMatchingRecordIds("no such content")).toEqual([]);
    });

    it("recordService.clearPayloads clears payloads while keeping records", async () => {
        const first = await recordService.create(1, 1, '{"q":1}');
        await recordService.update(Number(first.id), {
            response_data: '{"a":1}',
            status: SgRecordStatus.SUCCESS,
        });
        const second = await recordService.create(1, 1, '{"q":2}');
        await objectStorageService.putText("recording/keep-service", "keep");

        const before = await SgRecord.query().find(Number(first.id));
        await recordService.attachPayload(before!);
        expect(before!.request_data).toBe('{"q":1}');
        expect(before!.response_data).toBe('{"a":1}');

        const cleared = await recordService.clearPayloads();

        expect(cleared).toBe(2);
        expect(await SgRecord.query().find(Number(first.id))).not.toBeNull();
        expect(await SgRecord.query().find(Number(second.id))).not.toBeNull();
        expect(await objectStorageService.getText("recording/keep-service")).toBe("keep");

        const firstAfter = await SgRecord.query().find(Number(first.id));
        const secondAfter = await SgRecord.query().find(Number(second.id));
        await recordService.attachPayload(firstAfter!);
        await recordService.attachPayload(secondAfter!);

        expect(firstAfter!.request_data).toBeNull();
        expect(firstAfter!.response_data).toBeNull();
        expect(secondAfter!.request_data).toBeNull();
        expect(secondAfter!.response_data).toBeNull();
    });
});
