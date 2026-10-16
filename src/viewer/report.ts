import { send, type ProbeOutcome } from "../shared/messages";
import { defaultKind, describeBrowser, issueUrl, type ReportKind } from "../shared/report";
import { byId } from "./common";

export interface ReportState {
    // the GitHub page the user was on; becomes the editable address in the report dialog
    pageUrl: string;
    // a github.com file address the access probe can try, when there is one
    probeUrl?: string;
    error?: string;
    status?: number;
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
            const url = issueUrl({
                kind,
                urls,
                error: state?.error,
                probe: kind === "access" ? await probeText() : undefined,
                browser: describeBrowser(navigator.userAgent),
                version: chrome.runtime.getManifest().version
            });
            await chrome.tabs.create({ url });
            dialog.close();
        } finally {
            open.disabled = false;
        }
    });
}
