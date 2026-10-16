import { loadSettings, saveSettings, type AuthMode } from "../core/settings";
import { send, type ProbeOutcome } from "../shared/messages";

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const authMode = byId<HTMLSelectElement>("authMode");
const token = byId<HTMLInputElement>("token");
const saved = byId("saved");

const flash = (text: string) => {
    saved.textContent = text;
    setTimeout(() => { saved.textContent = ""; }, 2500);
}

const init = async () => {
    const settings = await loadSettings();
    authMode.value = settings.authMode;
    token.value = settings.token;
}

authMode.addEventListener("change", () => {
    void saveSettings({ authMode: authMode.value as AuthMode }).then(() => flash("Saved"));
});

byId("save").addEventListener("click", () => {
    void saveSettings({ token: token.value.trim() }).then(() => flash("Saved"));
});

byId("clear").addEventListener("click", () => {
    token.value = "";
    void saveSettings({ token: "" }).then(() => flash("Token removed"));
});

byId("probe").addEventListener("click", async () => {
    const out = byId("probe-result");
    out.hidden = false;
    out.textContent = "Testing…";
    try {
        const result = await send<{ ref: string; path: string; outcomes: ProbeOutcome[] }>({ type: "probe", url: byId<HTMLInputElement>("probe-url").value.trim() });
        out.textContent = [`ref: ${result.ref}`, `path: ${result.path}`, ...result.outcomes.map(o => `${o.ok ? "OK  " : "FAIL"} ${o.strategy.padEnd(9)} ${o.detail}`)].join("\n");
    } catch (error) {
        out.textContent = error instanceof Error ? error.message : String(error);
    }
});

void init();
