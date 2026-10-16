import { send, type ProbeOutcome } from "../shared/messages";
import { clipboardHtml, defaultKind, describeBrowser, htmlFitsInAddress, issueUrl, type ReportKind, type SharedHtml } from "../shared/report";
import { byId } from "./common";

export interface ReportState {
    // the GitHub page the user was on; becomes the editable address in the report dialog
    pageUrl: string;
    // a github.com file address the access probe can try, when there is one
    probeUrl?: string;
    error?: string;
    status?: number;
    // the HTML of the file(s) being viewed, offered in the dialog; absent until it has loaded
    html?: SharedHtml;
    // what the GitHub page offered (from the content script), as lines of names and counts, no file contents
    diagnostics?: string;
    // what the preview itself learned while loading, in the same spirit
    facts?: string[];
}

let state: ReportState | undefined;

export const setReportState = (patch: Partial<ReportState>) => {
    state = { ...(state ?? { pageUrl: "" }), ...patch };
}

const probeText = async (): Promise<string | undefined> => {
    if (!state?.probeUrl) return undefined;
    try {
        const result = await send<{ outcomes: ProbeOutcome[] }>({ type: "probe", url: state.probeUrl });
        return result.outcomes.map(outcome => `${outcome.ok ? "OK  " : "FAIL"} ${outcome.strategy}: ${outcome.detail}`).join("\n");
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
}

// Shows a load failure and remembers it, so a report made from here carries the message and a sensible category.
// A short fact about how loading went (a stage reached, a size, a status); never file contents or names.
export const addReportFact = (fact: string) => {
    setReportState({ facts: [...(state?.facts ?? []), fact] });
}

const diagnosticsText = (): string => [...(state?.diagnostics ? state.diagnostics.split("\n") : []), ...(state?.facts ?? []), ...(state?.status ? [`error status: ${state.status}`] : [])].join("\n");

export const showError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const status = typeof (error as { status?: unknown } | null)?.status === "number" ? (error as { status: number }).status : undefined;
    setReportState({ error: message, status });

    const box = byId("status");
    box.className = "error";
    box.textContent = message;
    box.hidden = false;
    const actions = document.createElement("div");
    actions.className = "error-actions";
    const button = document.createElement("button");
    button.type = "button";
    button.id = "report-from-error";
    button.className = "seg";
    button.textContent = "Report this problem";
    actions.append(button);
    box.append(actions);
}

export const openReportDialog = () => {
    const current = state ?? { pageUrl: "" };
    byId<HTMLSelectElement>("report-kind").value = defaultKind(current.status, !!current.error);
    byId<HTMLTextAreaElement>("report-urls").value = current.pageUrl;
    const include = byId<HTMLInputElement>("report-include-html");
    const has = !!(current.html?.before || current.html?.after);
    // always starts unticked: the HTML goes into a public issue, so sharing it is a fresh choice each time
    include.checked = false;
    include.disabled = !has;
    byId("report-html-hint").textContent = has
        ? "Publishes the file's HTML in the issue. Tick it when the repository is private and a link would not help, and only if the HTML holds nothing sensitive."
        : "No HTML has been loaded, so there is nothing to include.";
    byId<HTMLTextAreaElement>("report-diagnostics").value = diagnosticsText();
    byId("report-error").textContent = current.error ? `Error shown: ${current.error}` : "No error was shown; describe the problem on the GitHub form.";
    byId<HTMLDialogElement>("report-dialog").showModal();
}

export const initReport = (initial: ReportState) => {
    state = initial;
    const dialog = byId<HTMLDialogElement>("report-dialog");

    // delegated, because the error button is created when a failure happens
    document.addEventListener("click", event => {
        if ((event.target as Element | null)?.closest("#report, #report-from-error")) openReportDialog();
    });
    byId("report-cancel").addEventListener("click", () => dialog.close());

    byId("report-open").addEventListener("click", async () => {
        const open = byId<HTMLButtonElement>("report-open");
        open.disabled = true;
        try {
            const kind = byId<HTMLSelectElement>("report-kind").value as ReportKind;
            // the address the user confirmed in the dialog, not the one the extension started with
            const urls = byId<HTMLTextAreaElement>("report-urls").value;
            const html = byId<HTMLInputElement>("report-include-html").checked ? state?.html : undefined;
            if (html && !htmlFitsInAddress(html)) {
                // too long for the address: the form gets the start, the clipboard gets all of it
                await navigator.clipboard.writeText(clipboardHtml(html));
            }
            const url = issueUrl({
                kind,
                urls,
                error: state?.error,
                probe: kind === "access" ? await probeText() : undefined,
                html,
                diagnostics: byId<HTMLTextAreaElement>("report-diagnostics").value,
                browser: describeBrowser(navigator.userAgent),
                version: chrome.runtime.getManifest().version
            });
            await chrome.tabs.create({ url });
            dialog.close();
        } catch (error) {
            // the dialog stays open so the user can retry or copy the address by hand
            byId("report-error").textContent = `Could not open the issue form: ${error instanceof Error ? error.message : String(error)}`;
        } finally {
            open.disabled = false;
        }
    });
}
