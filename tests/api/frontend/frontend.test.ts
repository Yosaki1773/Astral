import { describe, it, expect } from "vitest";
import requestHelper from "../../helpers/requestHelper";
import { readdirSync } from "fs";
import { join } from "path";

/**
 * Frontend Static File Serving Tests
 * Verifies that the backend correctly serves frontend static files
 * and handles SPA routing
 *
 * Works in both node and worker modes
 */


/**
 * Helper to get the first available asset file of a given type (node mode only)
 */
function getFirstAsset(type: "js" | "css" | "svg"): string | null {
    const distPath = join(process.cwd(), "frontend", "dist");
    const assetsPath = join(distPath, "assets");

    try {
        if (type === "svg") {
            const files = readdirSync(distPath);
            const svg = files.find(f => f.endsWith(".svg"));
            return svg ? `/${svg}` : null;
        } else {
            const files = readdirSync(assetsPath);
            const file = files.find(f => f.endsWith(`.${type}`));
            return file ? `/assets/${file}` : null;
        }
    } catch {
        return null;
    }
}


/**
 * Helper to make a request and get raw text response
 */
async function getRaw(endpoint: string): Promise<{
    status: number;
    body: string;
    contentType: string | null;
}> {
    const response = await requestHelper.request(endpoint, { method: "GET" });
    const textBody = typeof response.body === "string"
        ? response.body
        : JSON.stringify(response.body);

    return {
        status: response.status,
        body: textBody,
        contentType: response.headers.get("content-type"),
    };
}


describe("Frontend Static File Serving", () => {
    describe("Homepage", () => {
        it("should serve HTML at root path", async () => {
            const response = await getRaw("/");

            expect(response.status).toBe(200);
            expect(response.contentType).toContain("text/html");
            expect(response.body).toContain("<!doctype html>");
            expect(response.body).toContain('<div id="app">');
        });
    });


    describe("Static Assets", () => {
        it("should serve JavaScript files", async () => {
            // Discover actual file (works in both modes)
            const asset = getFirstAsset("js");

            if (!asset) {
                console.warn("No JS assets found, skipping test");
                return;
            }

            const response = await getRaw(asset);
            expect(response.status).toBe(200);
            // Worker mode may return different content-type
            expect(response.contentType).toMatch(/javascript|octet-stream/);
        });


        it("should serve CSS files", async () => {
            // Discover actual file (works in both modes)
            const asset = getFirstAsset("css");

            if (!asset) {
                console.warn("No CSS assets found, skipping test");
                return;
            }

            const response = await getRaw(asset);
            expect(response.status).toBe(200);
            expect(response.contentType).toMatch(/css|octet-stream/);
        });


        it("should serve SVG files", async () => {
            // Discover actual file (works in both modes)
            const asset = getFirstAsset("svg");

            if (!asset) {
                console.warn("No SVG assets found, skipping test");
                return;
            }

            const response = await getRaw(asset);
            expect(response.status).toBe(200);
            expect(response.contentType).toContain("image/svg");
        });


        it("should serve the standalone viewer page route", async () => {
            // 对话可视化已内联为前端组件，独立查看页由前端路由 /#/viewer 承载
            const response = await getRaw("/viewer");

            expect(response.status).toBe(200);
            expect(response.contentType).toContain("text/html");
            expect(response.body).toContain("<!doctype html>");
            expect(response.body).toContain('<div id="app">');
        });
    });


    describe("SPA Fallback", () => {
        it("should return index.html for /dashboard", async () => {
            const response = await getRaw("/dashboard");

            expect(response.status).toBe(200);
            expect(response.contentType).toContain("text/html");
            expect(response.body).toContain("<!doctype html>");
            expect(response.body).toContain('<div id="app">');
        });


        it("should return index.html for /vendor", async () => {
            const response = await getRaw("/vendor");

            expect(response.status).toBe(200);
            expect(response.contentType).toContain("text/html");
            expect(response.body).toContain("<!doctype html>");
        });


        it("should return index.html for nested paths", async () => {
            const response = await getRaw("/some/nested/path");

            expect(response.status).toBe(200);
            expect(response.contentType).toContain("text/html");
        });
    });
});
