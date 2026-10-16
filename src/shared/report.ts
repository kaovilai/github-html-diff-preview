// "Report a problem": builds the address of a prefilled GitHub issue form. The extension never posts anything itself;
// the user reviews the form on github.com and presses Submit.

export const REPO = "kaovilai/github-html-diff-preview";

export type ReportKind = "access" | "render" | "other";

const TEMPLATES: { [kind in ReportKind]: { file: string; prefix: string; criteria: string } } = {
    access: { file: "access_problem.yml", prefix: "[access]", criteria: "- The page previews without an error" },
    render: { file: "rendering_bug.yml", prefix: "[render]", criteria: "- The preview matches how the page looks in a normal browser tab" },
    other: { file: "bug_report.yml", prefix: "[bug]", criteria: "- It works as expected" }
};

// Prefilled values travel percent-encoded in the address, which GitHub limits to roughly 8 KB. Limits count encoded
// characters, because non-ASCII text and newlines expand to several each.
const LIMITS = { urls: 1800, actual: 900, probe: 500, title: 240, html: 2000, diagnostics: 900 };

// What the user chose to share of the page being viewed (never sent anywhere but into the issue form they review).
export interface SharedHtml {
    before?: string;
    after?: string;
}

// GitHub rejects issue form fields over 65,536 characters, so the clipboard copy stays below that for both sides together.
const CLIPBOARD_LIMIT = 60000;
export const CLIPPED_MARKER = "\n<!-- clipped: the full HTML is on your clipboard; replace this text by pasting it -->";

const sides = (html: SharedHtml | undefined): [string, string][] =>
    (["before", "after"] as const).flatMap(side => html?.[side] ? [[side, html[side]!] as [string, string]] : []);

export interface ReportInput {
    kind: ReportKind;
    urls: string;
    error?: string;
    // output of the access probe, for access problems
    probe?: string;
    browser: string;
    version: string;
    // the page's own HTML, only when the user ticked the box
    html?: SharedHtml;
    // what the GitHub page offered and how loading went, as the user left it in the dialog (no file contents)
    diagnostics?: string;
}

const clip = (value: string, maxEncoded: number): string => {
    if (encodeURIComponent(value).length <= maxEncoded) return value;
    // longest prefix of whole characters (not code units) that still fits with the ellipsis; each character encodes
    // to at least one character, so the prefix is at most maxEncoded characters long
    const characters = Array.from(value).slice(0, maxEncoded);
    const fits = (count: number) => encodeURIComponent(characters.slice(0, count).join("") + "…").length <= maxEncoded;
    let low = 0, high = characters.length;
    while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (fits(mid)) low = mid;
        else high = mid - 1;
    }
    return characters.slice(0, low).join("") + "…";
}

// Per-side share of the address budget for the HTML.
const htmlBudget = (html: SharedHtml | undefined): number => Math.floor(LIMITS.html / Math.max(1, sides(html).length));

// Whether all of the shared HTML fits in the prefilled address. When it does not, the full text goes to the clipboard too.
export const htmlFitsInAddress = (html: SharedHtml | undefined): boolean =>
    sides(html).every(([, value]) => encodeURIComponent(value).length <= htmlBudget(html));

// The complete shared HTML as one text for the clipboard, labelled by side when there are two.
export const clipboardHtml = (html: SharedHtml | undefined): string => {
    const parts = sides(html);
    const text = parts.length === 1 ? parts[0][1] : parts.map(([side, value]) => `<!-- ${side} -->\n${value}`).join("\n");
    return text.length > CLIPBOARD_LIMIT ? text.slice(0, CLIPBOARD_LIMIT) + "\n<!-- clipped at 60000 characters -->" : text;
}

export const issueUrl = (input: ReportInput): string => {
    const template = TEMPLATES[input.kind];
    const error = (input.error ?? "").replace(/\s+/g, " ").trim();
    const params = new URLSearchParams();
    params.set("template", template.file);
    params.set("title", clip(`${template.prefix} ${error || "Problem with the preview"}`, LIMITS.title));
    params.set("urls", clip(input.urls.trim(), LIMITS.urls));
    params.set("actual", clip(error || "(describe what happened)", LIMITS.actual));
    params.set("criteria", template.criteria);
    if (input.kind === "access" && input.probe) params.set("probe", clip(input.probe, LIMITS.probe));
    if (input.diagnostics?.trim()) params.set("diagnostics", clip(input.diagnostics.trim(), LIMITS.diagnostics));
    const budget = htmlBudget(input.html);
    for (const [side, value] of sides(input.html)) {
        // a clipped side says so, so a report is never mistaken for the whole file
        const fits = encodeURIComponent(value).length <= budget;
        params.set(`${side}_html`, fits ? value : clip(value, budget - encodeURIComponent(CLIPPED_MARKER).length) + CLIPPED_MARKER);
    }
    params.set("browser", input.browser);
    params.set("version", input.version);
    return `https://github.com/${REPO}/issues/new?${params.toString()}`;
}

// A load failure that reads as "not found / no access / rate limited" is an access problem; anything else is not.
export const defaultKind = (status: number | undefined, hasError: boolean): ReportKind => {
    if (status === 401 || status === 403 || status === 404 || status === 429) return "access";
    return hasError ? "other" : "render";
}

export const describeBrowser = (userAgent: string): string => {
    const edge = /Edg\/([\d.]+)/.exec(userAgent);
    if (edge) return `Edge ${edge[1]}`;
    const firefox = /Firefox\/([\d.]+)/.exec(userAgent);
    if (firefox) return `Firefox ${firefox[1]}`;
    const chrome = /Chrome\/([\d.]+)/.exec(userAgent);
    if (chrome) return `Chrome ${chrome[1]}`;
    return userAgent.slice(0, 60);
}
