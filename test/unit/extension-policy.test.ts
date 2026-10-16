// The extension's promises, checked in the shipped sources: read-only requests to github.com only, no GitHub API,
// no stored secrets, and the smallest permission set that works.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");

const files = (dir: string): string[] => readdirSync(dir).flatMap(name => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? files(full) : [full];
});

const shipped = [...files(path.join(root, "src")), ...files(path.join(root, "static"))].filter(file => /\.(ts|js|html|css|json)$/.test(file));
const text = (file: string) => readFileSync(file, "utf8");

describe("extension policy", () => {
    it("never mentions the GitHub API host", () => {
        for (const file of shipped) expect(text(file), path.relative(root, file)).not.toMatch(/api\.github\.com/);
    });

    it("never stores anything with the storage API and never sends an Authorization header", () => {
        for (const file of shipped) {
            expect(text(file), path.relative(root, file)).not.toMatch(/chrome\.storage|browser\.storage/);
            expect(text(file), path.relative(root, file)).not.toMatch(/Authorization/i);
        }
    });

    it("only makes GET-style reads: no request bodies and no non-GET methods", () => {
        for (const file of shipped.filter(f => f.endsWith(".ts"))) {
            expect(text(file), path.relative(root, file)).not.toMatch(/method:\s*["'](POST|PUT|PATCH|DELETE)["']/i);
            // an options object passed to fetch() that carries a body would be an upload
            expect(text(file), path.relative(root, file)).not.toMatch(/fetch\([^)]*\{[^}]*\bbody\b/);
            expect(text(file), path.relative(root, file)).not.toMatch(/sendBeacon|XMLHttpRequest|WebSocket|EventSource/);
        }
    });

    it("requests the smallest permission set", () => {
        const manifest = JSON.parse(text(path.join(root, "src/manifest.json")));
        expect(manifest.permissions).toEqual(["contextMenus"]);
        expect(manifest.host_permissions).toEqual(["https://github.com/*", "https://raw.githubusercontent.com/*"]);
        expect(manifest.optional_permissions ?? []).toEqual([]);
    });

    it("keeps the fetch calls in the two modules that make them", () => {
        const callers = shipped.filter(f => f.endsWith(".ts") && /\bfetch\(|deps\.fetch\(/.test(text(f))).map(f => path.relative(root, f));
        expect(callers.sort()).toEqual(["src/background/index.ts", "src/core/fetcher.ts"]);
    });
});
