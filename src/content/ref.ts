// GitHub displays the branch/tag/commit being viewed, which settles where "<ref>/<path>" splits when the ref
// contains slashes. Every source is only a hint; refCandidates checks it against the URL before trusting it.

const embeddedRefName = (): string | undefined => {
    const script = document.querySelector('script[data-target="react-app.embeddedData"]');
    if (!script?.textContent) return undefined;
    try {
        const data = JSON.parse(script.textContent) as { payload?: { refInfo?: { name?: unknown } } };
        const name = data.payload?.refInfo?.name;
        return typeof name === "string" ? name : undefined;
    } catch {
        return undefined;
    }
}

const pickerText = (): string[] => {
    const selectors = ['[data-testid="anchor-button"] .ref-selector-button-text-container', "#branch-select-menu .css-truncate-target", "summary[data-hotkey='w'] .css-truncate-target", "[data-hotkey='w'] .css-truncate-target", "[data-hotkey='w'] span[class*='Text']"];
    const out: string[] = [];
    for (const selector of selectors) {
        document.querySelectorAll(selector).forEach(el => { const text = el.textContent?.trim(); if (text) out.push(text); });
    }
    return out;
}

export const findRef = (rest: string): string | undefined => {
    const candidates = [embeddedRefName(), ...pickerText()].filter((value): value is string => !!value);
    return candidates.filter(name => rest.startsWith(name + "/")).sort((a, b) => b.length - a.length)[0];
}
