import { runBlob } from "./blob";
import { runDiff } from "./diff";
import { byId } from "./common";
import { initReport, showError } from "./report";

const params = new URLSearchParams(location.hash.replace(/^#/, ""));
const theme = params.get("theme") || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
document.body.setAttribute("data-theme", theme === "dark" ? "dark" : "light");

const required = (name: string): string => {
    const value = params.get(name);
    if (!value) throw new Error(`Missing "${name}" in the preview address.`);
    return value;
}

// The GitHub page this preview came from: what a report should point at.
const sourcePage = (): { pageUrl: string; probeUrl?: string } => {
    const owner = params.get("owner"), repo = params.get("repo");
    if (!owner || !repo) return { pageUrl: "" };
    if (params.get("kind") === "blob") {
        const url = `https://github.com/${owner}/${repo}/blob/${params.get("rest") ?? ""}`;
        return { pageUrl: url, probeUrl: url };
    }
    const range = params.get("range");
    const page = `https://github.com/${owner}/${repo}/pull/${params.get("pr") ?? ""}/changes${range ? `/${range}` : ""}`;
    const after = params.get("after"), path = params.get("path");
    return {
        pageUrl: `${page}\n(file: ${path ?? ""})`,
        probeUrl: after && path ? `https://github.com/${owner}/${repo}/blob/${after}/${path}` : undefined
    };
}

const run = async () => {
    if (params.get("kind") === "pr") {
        await runDiff({ owner: required("owner"), repo: required("repo"), pr: Number(required("pr")), path: required("path"), range: params.get("range") || undefined, before: params.get("before") || undefined, after: params.get("after") || undefined });
    } else if (params.get("kind") === "blob") {
        await runBlob({ owner: required("owner"), repo: required("repo"), rest: required("rest"), ref: params.get("ref") || undefined });
    } else {
        throw new Error("This page previews HTML files from GitHub. Open a .html file on github.com and click Preview.");
    }
}

initReport(sourcePage());
byId("status").textContent = "Loading…";
run().catch(showError);
