import type { ScriptSummary } from "../core/html-prepare";
import { encodePath } from "../core/github-urls";
import { byId } from "./common";

export type ScriptChoice = "once" | "always" | "cancel";

export interface ScriptTarget {
    owner: string;
    repo: string;
    ref: string;
    summary: ScriptSummary;
}

const SHOWN = 20;

const addList = (container: HTMLElement, heading: string, items: string[]) => {
    if (!items.length) return;
    const title = document.createElement("h3");
    title.textContent = heading;
    const list = document.createElement("ul");
    // everything here is text from the repository's HTML, so it is only ever set as text
    for (const item of items.slice(0, SHOWN)) {
        const li = document.createElement("li");
        const code = document.createElement("code");
        code.textContent = item;
        li.append(code);
        list.append(li);
    }
    if (items.length > SHOWN) {
        const li = document.createElement("li");
        li.textContent = `…and ${items.length - SHOWN} more`;
        list.append(li);
    }
    container.append(title, list);
}

// The address each local script is fetched from, so what will run can be checked against the repository.
const rawUrl = (target: ScriptTarget, path: string) =>
    `https://github.com/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/raw/${target.ref.split("/").map(encodeURIComponent).join("/")}/${encodePath(path)}`;

// Asks before the page's scripts run. Resolves when the user decides; Escape or Cancel means "cancel".
export const confirmScripts = (target: ScriptTarget): Promise<ScriptChoice> => {
    const dialog = byId<HTMLDialogElement>("scripts-dialog");
    const { summary } = target;
    const name = `${target.owner}/${target.repo}`;

    byId("scripts-repo").textContent = name;
    byId("scripts-always").textContent = `Always allow ${name}`;
    const list = byId("scripts-list");
    list.replaceChildren();
    addList(list, "Scripts from this repository that will be fetched and run", summary.local.map(path => rawUrl(target, path)));
    if (summary.inline) {
        const p = document.createElement("p");
        p.textContent = `${summary.inline} inline script${summary.inline === 1 ? "" : "s"} will run.`;
        list.append(p);
    }
    addList(list, "Scripts hosted elsewhere (blocked: the sandbox does not load them)", summary.remote);
    if (!summary.local.length && !summary.inline) {
        const p = document.createElement("p");
        p.textContent = "No script files or inline scripts were found in this file.";
        list.append(p);
    }

    return new Promise<ScriptChoice>(resolve => {
        let choice: ScriptChoice = "cancel";
        const pick = (value: ScriptChoice) => () => { choice = value; dialog.close(); };
        const once = byId("scripts-once"), always = byId("scripts-always"), cancel = byId("scripts-cancel");
        const onOnce = pick("once"), onAlways = pick("always"), onCancel = pick("cancel");
        once.addEventListener("click", onOnce);
        always.addEventListener("click", onAlways);
        cancel.addEventListener("click", onCancel);
        // runs for every way the dialog closes, including Escape
        dialog.addEventListener("close", () => {
            once.removeEventListener("click", onOnce);
            always.removeEventListener("click", onAlways);
            cancel.removeEventListener("click", onCancel);
            resolve(choice);
        }, { once: true });
        dialog.showModal();
    });
}
