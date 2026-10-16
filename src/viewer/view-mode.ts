// The chosen diff layout is remembered in the viewer page's own storage, so the extension needs no `storage` permission.
export type ViewMode = "inline" | "split";

const KEY = "viewMode";

export const loadViewMode = (): ViewMode => {
    try {
        return localStorage.getItem(KEY) === "split" ? "split" : "inline";
    } catch {
        return "inline";
    }
}

export const saveViewMode = (mode: ViewMode): void => {
    try {
        localStorage.setItem(KEY, mode);
    } catch { /* storage can be unavailable in embedded frames; the default is fine */ }
}
