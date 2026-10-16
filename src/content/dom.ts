export const styled = <K extends keyof HTMLElementTagNameMap>(tag: K, css: string, text?: string): HTMLElementTagNameMap[K] => {
    const el = document.createElement(tag);
    el.style.cssText = css;
    if (text !== undefined) el.textContent = text;
    return el;
}

export const isDarkTheme = (): boolean => {
    const mode = document.documentElement.getAttribute("data-color-mode");
    return mode === "dark" || (mode === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
}

export const BUTTON_CSS = [
    "height:28px", "padding:0 10px", "margin-right:4px", "font-size:12px", "font-weight:500", "cursor:pointer",
    "border:1px solid var(--button-default-borderColor-rest, var(--borderColor-default, #d1d9e0))",
    "border-radius:6px",
    "background:var(--button-default-bgColor-rest, var(--bgColor-muted, #f6f8fa))",
    "color:var(--fgColor-default, #1f2328)"
].join(";");

export const BUTTON_CLASS = "hp-btn";

// Inline styles cannot express media queries, so touch sizing lives in a stylesheet (the !important beats the inline height).
export const ensureStyles = () => {
    if (document.getElementById("hp-content-style")) return;
    const style = document.createElement("style");
    style.id = "hp-content-style";
    style.textContent = `@media (pointer: coarse) { .${BUTTON_CLASS} { min-height: 44px !important; height: auto !important; min-width: 44px !important; padding-left: 16px !important; padding-right: 16px !important; font-size: 14px !important; } }`;
    (document.head || document.documentElement).appendChild(style);
}
