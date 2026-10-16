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
const LIMITS = { urls: 2400, actual: 1200, probe: 600, title: 240 };

export interface ReportInput {
    kind: ReportKind;
    urls: string;
    error?: string;
    // output of the access probe, for access problems
    probe?: string;
    browser: string;
    version: string;
}

const clip = (value: string, maxEncoded: number): string => {
    if (encodeURIComponent(value).length <= maxEncoded) return value;
    // trim by whole characters (not code units) until the ellipsis fits too
    const characters = Array.from(value);
    while (characters.length && encodeURIComponent(characters.join("") + "…").length > maxEncoded) characters.pop();
    return characters.join("") + "…";
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
