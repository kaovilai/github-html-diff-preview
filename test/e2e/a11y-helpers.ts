import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

// WCAG 2.2 level A and AA, which includes color-contrast (1.4.3) and target-size (2.5.8)
export const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

// Scans the page's own UI. Previewed repository HTML lives in sandboxed iframes; it is the user's content, not ours.
export const expectNoViolations = async (page: Page, include?: string) => {
    let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS).exclude("iframe");
    if (include) builder = builder.include(include);
    const { violations } = await builder.analyze();
    expect(violations.map(v => ({
        rule: v.id,
        impact: v.impact,
        targets: v.nodes.map(n => `${n.target.join(" ")}: ${n.failureSummary?.replace(/\s+/g, " ").slice(0, 200)}`)
    }))).toEqual([]);
}

export interface ControlReport {
    selector: string;
    text: string;
    ratio: number;
    width: number;
    height: number;
}

// Contrast of every matching control's text against what is actually behind it, in the control's current state.
// Computed in the page: semi-transparent backgrounds are blended down the ancestor chain onto white (or the canvas).
export const measureControls = (page: Page, selector: string): Promise<ControlReport[]> => page.evaluate(sel => {
    type RGBA = [number, number, number, number];
    const parse = (value: string): RGBA => {
        const m = /rgba?\(([^)]+)\)/.exec(value);
        if (!m) return [0, 0, 0, 0];
        const parts = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
        return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
    };
    const over = (top: RGBA, bottom: RGBA): RGBA => {
        const a = top[3] + bottom[3] * (1 - top[3]);
        if (a === 0) return [0, 0, 0, 0];
        const mix = (i: number) => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / a;
        return [mix(0), mix(1), mix(2), a];
    };
    const background = (el: Element): RGBA => {
        const layers: RGBA[] = [];
        for (let node: Element | null = el; node; node = node.parentElement) {
            layers.push(parse(getComputedStyle(node).backgroundColor));
            if (layers[layers.length - 1][3] === 1) break;
        }
        const canvas = parse(getComputedStyle(document.documentElement).backgroundColor);
        let result: RGBA = canvas[3] === 0 ? [255, 255, 255, 1] : canvas;
        for (let i = layers.length - 1; i >= 0; i--) result = over(layers[i], result);
        return result;
    };
    const channel = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const luminance = (c: RGBA) => 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);
    return Array.from(document.querySelectorAll(sel)).map((el, index) => {
        const style = getComputedStyle(el);
        const bg = background(el);
        const fg = over(parse(style.color), bg);
        const l1 = luminance(fg), l2 = luminance(bg);
        const rect = el.getBoundingClientRect();
        return {
            // unique per control, so a failing one is never hidden behind a passing one
            selector: `${el.id ? `#${el.id}` : el.tagName.toLowerCase()}[${index}] "${(el.textContent || "").trim().slice(0, 20)}"`,
            text: (el.textContent || "").trim().slice(0, 30),
            ratio: Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100,
            width: Math.round(rect.width),
            height: Math.round(rect.height)
        };
    });
}, selector);
