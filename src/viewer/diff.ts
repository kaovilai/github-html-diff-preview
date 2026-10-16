import { send, type FileChange } from "../shared/messages";
import { isSha } from "../core/github-urls";
import { loadViewMode, saveViewMode, type ViewMode } from "./view-mode";
import { buildViews, type Side as SideName, type Views } from "../core/html-diff";
import { rewriteUrls } from "../core/html-prepare";
import { setReportState } from "./report";
import { byId, fetchText, prepareSide, showNotice, STATIC_SANDBOX, type PreparedSide } from "./common";

const CHANGE_SELECTOR = "[data-hp-added], [data-hp-removed], [data-hp-modified], hp-del";

interface DiffParams {
    owner: string;
    repo: string;
    pr: number;
    path: string;
    range?: string;
    // the commits GitHub's own page is showing, read by the content script
    before?: string;
    after?: string;
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

interface Resolved {
    before: string | null;
    after: string;
    // undefined when the diff could not say; the status is then inferred from which side has the file
    change?: FileChange;
}

const resolve = async ({ owner, repo, path, before, after }: DiffParams): Promise<Resolved> => {
    if (!before || !after || !isSha(before) || !isSha(after)) {
        throw new Error("This page did not say which commits the pull request compares, so there is nothing to preview. Reload the Files changed tab and try again; if it keeps happening GitHub may have changed its page.");
    }
    const change = await send<FileChange | null>({ type: "pr-file-entry", owner, repo, before, after, path });
    return { before, after, change: change ?? undefined };
}

export const runDiff = async (params: DiffParams) => {
    const { owner, repo, path } = params;
    byId("diff-controls").hidden = false;

    const info = await resolve(params);
    const beforePath = info.change?.previous || path;
    const wanted = {
        before: info.change?.status !== "added" && !!info.before,
        after: info.change?.status !== "removed"
    };

    // when the status is unknown, a side that does not have the file tells us it was added or deleted
    const settle = async (want: boolean, ref: string | null, filePath: string): Promise<{ html: string; error?: unknown }> => {
        if (!want || !ref) return { html: "" };
        try {
            return { html: await fetchText({ owner, repo, ref, path: filePath }) };
        } catch (error) {
            // only a definite "not found" proves the side lacks the file; rate limits and network errors must surface
            if (info.change || (error as { status?: number }).status !== 404) throw error;
            return { html: "", error };
        }
    };
    const [beforeResult, afterResult] = await Promise.all([settle(wanted.before, info.before, beforePath), settle(wanted.after, info.after, path)]);
    if (beforeResult.error && afterResult.error) throw beforeResult.error;

    const hasBefore = wanted.before && !beforeResult.error;
    const hasAfter = wanted.after && !afterResult.error;
    const status = info.change?.status ?? (!hasBefore ? "added" : !hasAfter ? "removed" : "modified");
    const change = info.change ?? { status };
    const [beforeHtml, afterHtml] = [beforeResult.html, afterResult.html];
    setReportState({ html: { before: hasBefore ? beforeHtml : undefined, after: hasAfter ? afterHtml : undefined } });
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
        saveViewMode(mode);
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

    applyMode(loadViewMode());
    byId("status").hidden = true;
}
