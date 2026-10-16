import { scanBlobPage } from "./blob";
import { scanPrPage } from "./pr-diff";
import { findRef } from "./ref";

let scheduled = false;
const scan = () => {
    scheduled = false;
    try { scanBlobPage(); } catch { /* GitHub markup changed; leave the page alone */ }
    try { scanPrPage(); } catch { /* same */ }
}

// GitHub is a single-page app: pages are swapped in place, so keep watching instead of running once.
const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(scan);
}

schedule();
new MutationObserver(schedule).observe(document, { childList: true, subtree: true });

// The context menu and keyboard shortcut ask the page which part of the URL is the branch name.
chrome.runtime.onMessage.addListener((message: { type?: string; rest?: string }, _sender, sendResponse) => {
    if (message?.type !== "get-ref" || typeof message.rest !== "string") return false;
    sendResponse({ ref: findRef(message.rest) });
    return false;
});
