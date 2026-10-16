// Runs scripts/repro/cli.ts: bundles it with esbuild (jsdom stays external) and executes the result.
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outfile = path.join(root, "dist/repro/cli.mjs");
await build({
    entryPoints: [path.join(root, "scripts/repro/cli.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    logLevel: "error"
});
const result = spawnSync(process.execPath, [outfile, ...process.argv.slice(2)], { stdio: "inherit", cwd: process.cwd() });
process.exit(result.status ?? 1);
