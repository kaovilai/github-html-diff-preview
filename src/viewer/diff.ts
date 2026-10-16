import { send, type PrDiffInfo } from "../shared/messages";
import { loadSettings, saveSettings, type ViewMode } from "../core/settings";
import { buildViews, type Side as SideName, type Views } from "../core/html-diff";
import { rewriteUrls } from "../core/html-prepare";
import { byId, fetchText, prepareSide, showNotice, STATIC_SANDBOX, type PreparedSide } from "./common";

const CHANGE_SELECTOR = "[data-hp-added], [data-hp-removed], [data-hp-modified], hp-del";

interface DiffParams {
    owner: string;
    repo: string;
    pr: number;
    path: string;
    range?: string;
}

const makeFrame = (html: string): HTMLIFrameElement => {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", STATIC_SANDBOX);
    frame.srcdoc = html;
    return frame;
}

const makePane = (title: string, content: HTMLElement): HTMLElement => {
    const pane = document.createElement("section");
    pane.className = "pane";
    const heading = document.createElement("div");
    heading.className = "pane-title";
    heading.textContent = title;
    pane.append(heading, content);
    return pane;
}

const placeholder = (text: string): HTMLElement => {
    const el = document.createElement("div");
    el.className = "placeholder";
    el.textContent = text;
    return el;
}

const shortSha = (sha: string | null) => sha ? sha.slice(0, 7) : "none";

const scrollRatioSync = (from: HTMLIFrameElement, to: HTMLIFrameElement, ignoreUntil: { [key: string]: number }, key: string, otherKey: string) => {
    const source = from.contentWindow!, target = to.contentWindow!;
    source.addEventListener("scroll", () => {
        if (Date.now() < ignoreUntil[key]) return;
        const sourceMax = source.document.documentElement.scrollHeight - source.innerHeight;
        const targetMax = target.document.documentElement.scrollHeight - target.innerHeight;
        if (sourceMax <= 0 || targetMax <= 0) return;
        ignoreUntil[otherKey] = Date.now() + 120;
        target.scrollTo(0, (source.scrollY / sourceMax) * targetMax);
    });
}

export const runDiff = async ({ owner, repo, pr, path, range }: DiffParams) => {
    byId("diff-controls").hidden = false;

    const info = await send<PrDiffInfo>({ type: "pr-info", owner, repo, pr, range });
    const change = info.files[path];
    if (!change) throw new Error(`${path} is not part of this diff.`);

    const status = change.status;
    const beforePath = change.previous || path;
    const hasBefore = status !== "added" && !!info.before;
    const hasAfter = status !== "removed";

    const [beforeHtml, afterHtml] = await Promise.all([
        hasBefore ? fetchText({ owner, repo, ref: info.before!, path: beforePath }) : Promise.resolve(""),
        hasAfter ? fetchText({ owner, repo, ref: info.after, path }) : Promise.resolve("")
    ]);
    const [before, after] = await Promise.all([
        prepareSide({ owner, repo, ref: info.before || "", path: beforePath, html: beforeHtml }),
        prepareSide({ owner, repo, ref: info.after, path, html: afterHtml })
    ]);
    const sides: { [side in SideName]: PreparedSide } = { before, after };

    // diff the sanitized sources as written; URLs are rewritten afterwards so unchanged relative URLs stay unchanged
    const views: Views = buildViews(side => sides[side].makeDocument(), (root, side) => rewriteUrls(root, sides[side].ctx));

    if (status === "added") showNotice("New file: everything is shown as added.");
    else if (status === "removed") showNotice("File deleted: its previous content is in the red bubble (inline) or left pane (side by side).");
    else if (change.previous) showNotice(`Renamed from ${change.previous}`);

    const { added, removed, modified } = views.stats;
    byId("stats").textContent = (added + removed + modified) === 0
        ? "No visible changes in <body>"
        : `+${added} added · −${removed} removed · ${modified} changed`;

    const inlineFrame = makeFrame(views.inline);
    const beforeFrame = hasBefore ? makeFrame(views.before) : null;
    const afterFrame = hasAfter ? makeFrame(views.after) : null;

    const inlinePane = makePane(`Inline · ${shortSha(info.after)}`, inlineFrame);
    const beforePane = makePane(`Before · ${shortSha(info.before)}`, beforeFrame || placeholder("File did not exist"));
    const afterPane = makePane(`After · ${shortSha(info.after)}`, afterFrame || placeholder("File was deleted"));
    inlinePane.style.flex = "1";

    byId("stage").append(inlinePane, beforePane, afterPane);

    if (beforeFrame && afterFrame) {
        const ignoreUntil: { [key: string]: number } = { before: 0, after: 0 };
        beforeFrame.addEventListener("load", () => scrollRatioSync(beforeFrame, afterFrame, ignoreUntil, "before", "after"));
        afterFrame.addEventListener("load", () => scrollRatioSync(afterFrame, beforeFrame, ignoreUntil, "after", "before"));
    }

    let mode: ViewMode = "inline";
    // index into the current frame's change list; reset whenever that list changes
    let cursor = -1;
    const applyMode = (next: ViewMode) => {
        mode = next;
        cursor = -1;
        inlinePane.hidden = mode !== "inline";
        beforePane.hidden = afterPane.hidden = mode !== "split";
        byId("mode-inline").classList.toggle("active", mode === "inline");
        byId("mode-split").classList.toggle("active", mode === "split");
        void saveSettings({ viewMode: mode });
    };
    byId("mode-inline").onclick = () => applyMode("inline");
    byId("mode-split").onclick = () => applyMode("split");

    // side by side steps through the additions/edits on the right, then the removals on the left
    const step = (direction: number) => {
        const frames = mode === "inline" ? [inlineFrame] : [afterFrame, beforeFrame];
        const targets: HTMLElement[] = [];
        for (const frame of frames) {
            const doc = frame?.contentDocument;
            if (doc) targets.push(...Array.from(doc.querySelectorAll<HTMLElement>(CHANGE_SELECTOR)));
        }
        if (!targets.length) return;

        cursor = (cursor + direction + targets.length) % targets.length;
        const target = targets[cursor];
        target.scrollIntoView({ block: "center", behavior: "smooth" });
        target.removeAttribute("data-hp-focus");
        void target.offsetWidth;
        target.setAttribute("data-hp-focus", "");
    };
    byId("prev").onclick = () => step(-1);
    byId("next").onclick = () => step(1);

    applyMode((await loadSettings()).viewMode);
    byId("status").hidden = true;
}
