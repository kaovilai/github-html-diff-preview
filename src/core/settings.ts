export type AuthMode = "auto" | "session" | "token" | "anonymous";
export type ViewMode = "inline" | "split";

export interface Settings {
    // GitHub personal access token; only ever sent to api.github.com
    token: string;
    authMode: AuthMode;
    viewMode: ViewMode;
}

export const DEFAULT_SETTINGS: Settings = { token: "", authMode: "auto", viewMode: "inline" };

const AUTH_MODES: AuthMode[] = ["auto", "session", "token", "anonymous"];

export const loadSettings = async (): Promise<Settings> => {
    const stored = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
    return {
        token: typeof stored.token === "string" ? stored.token.trim() : "",
        authMode: AUTH_MODES.find(mode => mode === stored.authMode) ?? "auto",
        viewMode: stored.viewMode === "split" ? "split" : "inline"
    };
}

export const saveSettings = (patch: Partial<Settings>): Promise<void> => chrome.storage.local.set(patch);
