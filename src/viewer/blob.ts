import { send, type ResolvedBlob } from "../shared/messages";
import { getScriptPaths, loadScripts, rewriteUrls, serializeDocument } from "../core/html-prepare";
import { byId, fetchText, prepareSide, STATIC_SANDBOX } from "./common";
import { setReportState, showError } from "./report";

const SCRIPT_SANDBOX = "allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals";

// Only Chrome supports manifest sandbox pages; elsewhere the scripts toggle is not offered.
const scriptsSupported = (): boolean => !!chrome.runtime.getManifest().sandbox;

interface BlobParams {
    owner: string;
    repo: string;
    rest: string;
    ref?: string;
}

const renderStatic = (html: string): HTMLIFrameElement => {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", STATIC_SANDBOX);
    frame.srcdoc = html;
    return frame;
}

// Untrusted scripts only ever run in the manifest sandbox page: an opaque origin with no access to extension APIs.
const renderScripted = (html: string): HTMLIFrameElement => {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", SCRIPT_SANDBOX);
    frame.src = chrome.runtime.getURL("sandbox/frame.html");
    frame.addEventListener("load", () => frame.contentWindow?.postMessage({ type: "hp-render", html }, "*"), { once: true });
    return frame;
}

export const runBlob = async ({ owner, repo, rest, ref: hint }: BlobParams) => {
    byId("blob-controls").hidden = false;
    const blob = await send<ResolvedBlob>({ type: "resolve-blob", owner, repo, rest, ref: hint });
    const { ref, path, text } = blob;
    setReportState({ html: { after: text } });

    document.title = `${path.split("/").pop()} · HTML preview`;
    byId("title").textContent = `${owner}/${repo}@${ref} · ${path}`;
    const github = byId<HTMLAnchorElement>("github-link");
    github.href = `https://github.com/${owner}/${repo}/blob/${ref.split("/").map(encodeURIComponent).join("/")}/${path.split("/").map(encodeURIComponent).join("/")}`;

    const toggle = byId<HTMLInputElement>("run-scripts");
    const scriptWarning = byId("script-warning");
    byId("scripts-label").hidden = !scriptsSupported();

    // a slower earlier render must not replace the frame of a newer one when the toggle is flipped quickly
    let generation = 0;
    const render = async () => {
        const mine = ++generation;
        const allowScripts = toggle.checked;
        scriptWarning.hidden = !allowScripts;
        byId("status").hidden = false;
        byId("status").textContent = "Loading…";
        byId("status").className = "";

        let scripts: Map<string, string> | undefined;
        if (allowScripts) {
            const doc = new DOMParser().parseFromString(text, "text/html");
            scripts = await loadScripts(getScriptPaths(doc, path), scriptPath => fetchText({ owner, repo, ref, path: scriptPath }));
        }

        const prepared = await prepareSide({ owner, repo, ref, path, html: text }, { allowScripts, scripts });
        const doc = prepared.makeDocument();
        rewriteUrls(doc, prepared.ctx);
        const html = serializeDocument(doc);
        if (mine !== generation) return;

        const frame = allowScripts ? renderScripted(html) : renderStatic(html);
        byId("stage").querySelectorAll("iframe").forEach(old => old.remove());
        byId("stage").append(frame);
        byId("status").hidden = true;
    };

    toggle.addEventListener("change", () => {
        render().catch(showError);
    });
    await render();
}
