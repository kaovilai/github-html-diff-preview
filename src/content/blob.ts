// Adds a "Preview" button next to GitHub's "Raw" button on .html/.htm blob pages.

import { parseBlobPath, type BlobLocation } from "../core/github-urls";
import { send } from "../shared/messages";
import { BUTTON_CSS, styled } from "./dom";
import { findRef } from "./ref";

const BUTTON_ATTR = "data-hp-blob-button";
const RAW_SELECTORS = ['[data-testid="raw-button"]', "#raw-url", 'a[href*="/raw/"].btn'];

const findRawButton = (): HTMLElement | null => {
    for (const selector of RAW_SELECTORS) {
        const el = document.querySelector<HTMLElement>(selector);
        if (el) return el;
    }
    return null;
}

const makeButton = (blob: BlobLocation, anchor: HTMLElement | null): HTMLButtonElement => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Preview";
    button.title = "Preview this HTML file locally";
    button.setAttribute(BUTTON_ATTR, blob.rest);
    // borrow the Raw button's classes so it looks native; fall back to inline styles when there is no anchor
    if (anchor?.className) button.className = anchor.className;
    else button.style.cssText = BUTTON_CSS + ";position:fixed;right:16px;bottom:16px;z-index:100;box-shadow:0 2px 8px rgba(0,0,0,.2)";
    button.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        send({ type: "open-preview", owner: blob.owner, repo: blob.repo, rest: blob.rest, ref: findRef(blob.rest) }).catch(() => {
            const note = styled("span", "margin-left:8px;color:#cf222e", "Could not open the preview.");
            button.after(note);
            setTimeout(() => note.remove(), 4000);
        });
    });
    return button;
}

export const scanBlobPage = () => {
    const blob = parseBlobPath(location.pathname);
    const existing = document.querySelector<HTMLElement>(`[${BUTTON_ATTR}]`);

    if (!blob) {
        existing?.remove();
        return;
    }

    const anchor = findRawButton();
    const floating = existing && !existing.className;
    if (existing && existing.getAttribute(BUTTON_ATTR) === blob.rest && existing.isConnected && !(floating && anchor)) return;
    existing?.remove();

    const button = makeButton(blob, anchor);
    if (anchor) {
        const group = anchor.closest<HTMLElement>('[data-component="ButtonGroup"], .BtnGroup') ?? anchor;
        group.insertAdjacentElement("beforebegin", button);
        button.style.marginRight = "6px";
    } else {
        document.body.appendChild(button);
    }
}
