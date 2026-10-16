// Reproducible store zips: fixed entry order and timestamps, so the same sources give the same bytes.
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { zipSync } from "fflate";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

const walk = async (dir, base = dir) => {
    const files = [];
    for (const entry of (await readdir(dir)).sort()) {
        const full = path.join(dir, entry);
        if ((await stat(full)).isDirectory()) files.push(...await walk(full, base));
        else files.push(path.relative(base, full).split(path.sep).join("/"));
    }
    return files;
}

for (const target of ["chrome", "firefox"]) {
    const dir = path.join(root, "dist", target);
    const entries = {};
    for (const file of await walk(dir)) {
        entries[file] = [new Uint8Array(await readFile(path.join(dir, file))), { mtime: new Date("2026-01-01T00:00:00Z"), level: 9 }];
    }
    const out = path.join(root, "dist", `github-html-preview-${target}-${pkg.version}.zip`);
    await writeFile(out, zipSync(entries));
    console.log(`wrote ${path.relative(root, out)}`);
}
