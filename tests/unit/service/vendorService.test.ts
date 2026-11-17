import { afterEach, describe, expect, it, vi } from "vitest";
import { SgVendor, SgVendorConfig } from "../../../src/model/sgVendor";
import { ApiFormat, VendorAuthMode } from "../../../src/constants";
import vendorService from "../../../src/service/vendorService";
import fetchUtil from "../../../src/util/fetchUtil";
import ormService from "../../../src/service/ormService";
import vendorManager from "../../../src/manager/vendorManager";


describe("vendor model discovery", () => {
    afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

    it.each([ApiFormat.OPENAI, ApiFormat.RESPONSES, ApiFormat.ANTHROPIC])("uses normalized %s URL and protocol authentication", async format => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [
            { id: "chat-model" }, { id: "chat-model" }, { id: "whisper-1" }, { id: 123 }, {},
        ] })));
        vi.stubGlobal("fetch", fetchMock);
        const vendor = new SgVendor({ type: "other", token: "key", urls: { [format]: "https://example.test///" }, config: new SgVendorConfig({ auth_mode: VendorAuthMode.API_KEY }) });
        expect(await vendorService.fetchUpstreamModels(vendor)).toEqual(["chat-model"]);
        const [url, options] = fetchMock.mock.calls[0];
        expect(url).toBe("https://example.test/v1/models");
        expect(options.headers).toMatchObject(format === ApiFormat.ANTHROPIC
            ? { "x-api-key": "key", "anthropic-version": "2023-06-01" }
            : { Authorization: "Bearer key" });
        expect(options.signal).toBeInstanceOf(AbortSignal);
        expect(vendor.urls[format]).toBe("https://example.test///");
    });

    it("honors bearer token, UA, proxy and TLS configuration in Node", async () => {
        vi.spyOn(ormService, "isNode", "get").mockReturnValue(true);
        const dispatcher = {} as any;
        const getDispatcher = vi.spyOn(fetchUtil, "getDispatcher").mockResolvedValue(dispatcher);
        const fetchMock = vi.fn().mockResolvedValue(new Response('{"data":[]}'));
        vi.stubGlobal("fetch", fetchMock);
        const vendor = new SgVendor({ type: "other", token: "Bearer existing", urls: { anthropic: "https://example.test/v1/messages" }, config: new SgVendorConfig({
            auth_mode: VendorAuthMode.BEARER_TOKEN, skip_tls_verify: true,
            user_agent_enabled: true, user_agent: "custom-UA", proxy: { type: "http", url: "http://proxy.test" },
        }) });
        await vendorService.fetchUpstreamModels(vendor);
        expect(getDispatcher).toHaveBeenCalledWith(vendor.config);
        expect(fetchMock).toHaveBeenCalledWith("https://example.test/v1/models", expect.objectContaining({ dispatcher, headers: expect.objectContaining({ Authorization: "Bearer existing", "User-Agent": "custom-UA" }) }));
    });

    it("does not load a Node dispatcher in Worker mode", async () => {
        vi.spyOn(ormService, "isNode", "get").mockReturnValue(false);
        const getDispatcher = vi.spyOn(fetchUtil, "getDispatcher");
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"data":[]}')));
        await vendorService.fetchUpstreamModels(new SgVendor({ type: "other", token: "key", urls: { openai: "https://example.test" } }));
        expect(getDispatcher).not.toHaveBeenCalled();
    });

    it("reports unavailable configuration and upstream failures", async () => {
        await expect(vendorService.fetchUpstreamModels(new SgVendor({ type: "other", token: "key" }))).rejects.toMatchObject({ statusCode: 400 });
        const vendor = new SgVendor({ type: "other", token: "key", urls: { openai: "https://example.test" } });
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("denied", { status: 401 })));
        await expect(vendorService.fetchUpstreamModels(vendor)).rejects.toThrow("Upstream returned 401: denied");
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
        await expect(vendorService.fetchUpstreamModels(vendor)).rejects.toThrow("Failed to fetch models: fetch failed");
    });

    it("does not turn call timestamp failures into gateway failures", async () => {
        vi.spyOn(vendorManager, "markCalled").mockRejectedValue(new Error("DB busy"));
        vi.spyOn(console, "warn").mockImplementation(() => {});
        await expect(vendorService.recordCall(1, 100)).resolves.toBeUndefined();
    });
});
