import { runBlob } from "./blob";
import { runDiff } from "./diff";
import { byId, showError } from "./common";

const params = new URLSearchParams(location.hash.replace(/^#/, ""));
const theme = params.get("theme") || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
document.body.setAttribute("data-theme", theme === "dark" ? "dark" : "light");

const required = (name: string): string => {
    const value = params.get(name);
    if (!value) throw new Error(`Missing "${name}" in the preview address.`);
    return value;
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

byId("status").textContent = "Loading…";
run().catch(error => showError(error instanceof Error ? error.message : String(error)));
