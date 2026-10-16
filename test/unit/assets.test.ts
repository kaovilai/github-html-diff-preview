import { describe, expect, it } from "vitest";
import { assetMime, loadAssets, toDataUrl } from "../../src/core/assets";

const budget = { maxAssets: 3, maxBytesEach: 1000, maxBytesTotal: 100, concurrency: 2 };
const url = (bytes: number) => toDataUrl("image/png", new Uint8Array(bytes));

describe("assets", () => {
    it("maps known extensions to mime types and refuses others", () => {
        expect(assetMime("a/b.PNG")).toBe("image/png");
        expect(assetMime("f.woff2")).toBe("font/woff2");
        expect(assetMime("run.js")).toBeUndefined();
        expect(assetMime("noext")).toBeUndefined();
    });

    it("encodes bytes as base64 data URLs", () => {
        expect(toDataUrl("text/plain", new TextEncoder().encode("hi"))).toBe("data:text/plain;base64,aGk=");
        expect(toDataUrl("image/png", new Uint8Array(100_000)).length).toBeGreaterThan(130_000);
    });

    it("caps the number of assets, skips non-assets, and ignores failures", async () => {
        const seen: string[] = [];
        const assets = await loadAssets(["a.png", "x.js", "b.png", "c.png", "d.png", "e.png"], async path => {
            seen.push(path);
            if (path === "b.png") throw new Error("404");
            return url(3);
        }, budget);
        expect(seen).not.toContain("x.js");
        expect(seen).not.toContain("e.png");
        expect(Array.from(assets.keys()).sort()).toEqual(["a.png", "c.png"]);
    });

    it("stops once the total byte budget is used", async () => {
        const assets = await loadAssets(["a.png", "b.png", "c.png"], async () => url(60), { ...budget, concurrency: 1 });
        expect(assets.size).toBe(1);
    });
});
