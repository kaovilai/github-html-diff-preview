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
