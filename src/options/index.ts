import { send, type ProbeOutcome } from "../shared/messages";
import { listTrusted, untrustAll, untrustRepo } from "../shared/script-trust";

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

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

// Repositories the user chose to "always allow" scripts for; removing one brings the confirmation back.
const renderTrusted = () => {
    const repos = listTrusted();
    byId("trusted-empty").hidden = repos.length > 0;
    byId("trusted-clear").hidden = repos.length === 0;
    byId("trusted-list").replaceChildren(...repos.map(key => {
        const item = document.createElement("li");
        const link = document.createElement("a");
        link.href = `https://github.com/${key}`;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        const code = document.createElement("code");
        code.textContent = key;
        link.append(code);
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "Remove";
        remove.setAttribute("aria-label", `Remove ${key} from the list`);
        remove.addEventListener("click", () => { untrustRepo(key); renderTrusted(); });
        item.append(link, remove);
        return item;
    }));
}

byId("trusted-clear").addEventListener("click", () => { untrustAll(); renderTrusted(); });
// a preview tab can change the list while this page is open
window.addEventListener("storage", renderTrusted);
renderTrusted();
