import { send, type ProbeOutcome } from "../shared/messages";

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
