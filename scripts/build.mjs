// Bundles the extension with esbuild and writes one unpacked extension directory per browser target.
//   node scripts/build.mjs            chrome + firefox
//   node scripts/build.mjs chrome     just one
import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const targets = process.argv.slice(2).length ? process.argv.slice(2) : ["chrome", "firefox"];

const ENTRIES = {
    background: "src/background/index.ts",
    content: "src/content/index.ts",
    viewer: "src/viewer/index.ts",
    options: "src/options/index.ts",
    sandbox: "src/sandbox/frame.ts"
};

// The Firefox build has no manifest sandbox page (unsupported), so it also drops the scripts-mode entry point.
const manifestFor = async (target) => {
    const manifest = JSON.parse(await readFile(path.join(root, "src/manifest.json"), "utf8"));
    manifest.version = pkg.version;
    if (target === "firefox") {
        delete manifest.sandbox;
        delete manifest.content_security_policy;
        delete manifest.minimum_chrome_version;
        manifest.background = { scripts: ["background.js"] };
        manifest.browser_specific_settings = { gecko: { id: "github-html-preview@kaovilai.github.io", strict_min_version: "128.0", data_collection_permissions: { required: ["none"] } } };
    }
    return manifest;
}

for (const target of targets) {
    if (!["chrome", "firefox"].includes(target)) throw new Error(`Unknown target: ${target}`);
    const out = path.join(root, "dist", target);
    await rm(out, { recursive: true, force: true });
    await mkdir(out, { recursive: true });

    const entries = Object.fromEntries(Object.entries(ENTRIES).filter(([name]) => !(target === "firefox" && name === "sandbox")));
    await build({
        entryPoints: Object.fromEntries(Object.entries(entries).map(([name, file]) => [name, path.join(root, file)])),
        outdir: out,
        bundle: true,
        format: "iife",
        target: ["chrome112", "firefox128"],
        sourcemap: false,
        minify: false,
        legalComments: "none",
        logLevel: "warning"
    });

    await cp(path.join(root, "static"), out, { recursive: true, filter: src => !(target === "firefox" && src.includes(`${path.sep}sandbox`)) });
    await writeFile(path.join(out, "manifest.json"), JSON.stringify(await manifestFor(target), null, 2) + "\n");
    console.log(`built dist/${target}`);
}
