// Usage (via `npm run repro --`):
//   file <github blob url>                      fetch a public file and report what the extension would do with it
//   file ./page.html [--path dir/page.html]     the same for a local file (relative assets are looked up in --repo)
//   diff <before.html> <after.html>             diff two local files
//   pr <github pull request url> <file path>    diff one file of a public pull request
// Options: --out <dir> writes before/after/inline views and report.json. GITHUB_TOKEN or GH_TOKEN is used for API calls.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { JSDOM } from "jsdom";
import { FileFetcher } from "../../src/core/fetcher";
import { parseBlobPath, refCandidates } from "../../src/core/github-urls";
import { PrInfoLoader } from "../../src/core/pr-info";
import type { Settings } from "../../src/core/settings";
import { analyzeDiff, prepareSide, type DiffReport, type Fetchers, type Loc, type Parse } from "./lib";

const parse: Parse = html => new JSDOM(html).window.document;

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
const settings: Settings = { token, authMode: "auto", viewMode: "inline" };
const fetcher = new FileFetcher({ fetch: (input, init) => fetch(input, init), getSettings: async () => settings, now: Date.now });

const remote = (owner: string, repo: string): Fetchers => ({
    text: (filePath, ref) => fetcher.fetchText({ owner, repo, ref, path: filePath }),
    exists: (filePath, ref) => fetcher.fetchBytes({ owner, repo, ref, path: filePath }, 2 * 1024 * 1024).then(() => true, () => false)
});

const flag = (args: string[], name: string): string | undefined => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
}

const positional = (args: string[]): string[] => {
    const out: string[] = [];
    for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith("--")) i++;
        else out.push(args[i]);
    }
    return out;
}

const fileFromUrl = async (url: string) => {
    const blob = parseBlobPath(new URL(url).pathname);
    if (!blob) throw new Error("Expected a https://github.com/<owner>/<repo>/blob/<ref>/<path>.html URL.");
    const fetchers = remote(blob.owner, blob.repo);
    let last: unknown;
    for (const { ref, path: filePath } of refCandidates(blob.rest)) {
        try {
            return { html: await fetchers.text(filePath, ref), loc: { owner: blob.owner, repo: blob.repo, ref, path: filePath } as Loc, fetchers };
        } catch (error) {
            last = error;
        }
    }
    throw last;
}

// the rendered views are large; they go to --out, not to the console
const withoutViews = (report: DiffReport) => ({ before: report.before, after: report.after, stats: report.stats });

const write = async (out: string | undefined, report: unknown, report2?: DiffReport) => {
    if (!out) return;
    await mkdir(out, { recursive: true });
    await writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2));
    if (report2?.views) {
        for (const view of ["before", "after", "inline"] as const) await writeFile(path.join(out, `${view}.html`), report2.views[view]);
    }
}

const main = async () => {
    const [mode, ...rest] = process.argv.slice(2);
    const args = positional(rest);
    const out = flag(rest, "--out");

    if (mode === "file") {
        const target = args[0];
        let html: string, loc: Loc, fetchers: Fetchers;
        if (/^https:\/\/github\.com\//.test(target)) {
            ({ html, loc, fetchers } = await fileFromUrl(target));
        } else {
            const [owner, repo] = (flag(rest, "--repo") ?? "o/r").split("/");
            html = await readFile(target, "utf8");
            loc = { owner, repo, ref: flag(rest, "--ref") ?? "main", path: flag(rest, "--path") ?? path.basename(target) };
            fetchers = flag(rest, "--repo") ? remote(owner, repo) : { text: () => Promise.reject(new Error("offline")), exists: () => Promise.resolve(false) };
        }
        const prepared = await prepareSide(html, loc, fetchers, parse);
        console.log(JSON.stringify(prepared.report, null, 2));
        await write(out, prepared.report);
    } else if (mode === "diff") {
        const [beforeFile, afterFile] = args;
        const fetchers: Fetchers = { text: () => Promise.reject(new Error("offline")), exists: () => Promise.resolve(false) };
        const loc = { owner: "o", repo: "r", path: flag(rest, "--path") ?? "index.html" };
        const report = await analyzeDiff(
            { html: await readFile(beforeFile, "utf8"), loc: { ...loc, ref: "BEFORE" } },
            { html: await readFile(afterFile, "utf8"), loc: { ...loc, ref: "AFTER" } },
            fetchers, parse);
        console.log(JSON.stringify(withoutViews(report), null, 2));
        await write(out, withoutViews(report), report);
    } else if (mode === "pr") {
        const [url, filePath] = args;
        const match = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(new URL(url).pathname);
        if (!match || !filePath) throw new Error("Usage: pr <https://github.com/o/r/pull/N/files> <path of the HTML file>");
        const [, owner, repo, number] = match;
        const info = await new PrInfoLoader(fetcher, async () => settings).get({ owner, repo, pr: Number(number) });
        const change = info.files[filePath];
        if (!change) throw new Error(`${filePath} is not part of pull request #${number}. Files: ${Object.keys(info.files).join(", ")}`);
        const fetchers = remote(owner, repo);
        const beforePath = change.previous || filePath;
        const before = change.status !== "added" && info.before ? { html: await fetchers.text(beforePath, info.before), loc: { owner, repo, ref: info.before, path: beforePath } } : null;
        const after = change.status !== "removed" ? { html: await fetchers.text(filePath, info.after), loc: { owner, repo, ref: info.after, path: filePath } } : null;
        const report = await analyzeDiff(before, after, fetchers, parse);
        const summary = { status: change.status, previous: change.previous, beforeCommit: info.before, afterCommit: info.after, ...withoutViews(report) };
        console.log(JSON.stringify(summary, null, 2));
        await write(out, summary, report);
    } else {
        console.error("Usage: npm run repro -- file <url|file> | diff <before> <after> | pr <url> <path>  [--out dir]");
        process.exit(2);
    }
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
