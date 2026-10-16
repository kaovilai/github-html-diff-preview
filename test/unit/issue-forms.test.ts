// The issue forms are a contract with the automated issue helper (.github/workflows/issue-responder.md), which reads
// the submitted sections by their labels. GitHub parses these files as YAML 1.1, where an unquoted No/Yes is a boolean.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const dir = path.resolve(__dirname, "../../.github/ISSUE_TEMPLATE");
const forms = readdirSync(dir).filter(name => name.endsWith(".yml") && name !== "config.yml");

interface Field {
    type: string;
    id?: string;
    attributes?: { label?: string; options?: unknown[]; render?: string };
    validations?: { required?: boolean };
}

const load = (name: string) => parse(readFileSync(path.join(dir, name), "utf8"), { version: "1.1" }) as { name: string; description: string; body: Field[] };

describe("issue forms", () => {
    it("has the forms the helper expects", () => {
        expect(forms.sort()).toEqual(["access_problem.yml", "bug_report.yml", "feature_request.yml", "missing_button.yml", "rendering_bug.yml"]);
    });

    for (const name of forms) {
        describe(name, () => {
            const form = load(name);
            const inputs = form.body.filter(field => field.type !== "markdown");

            it("has a name, a description and unique ids", () => {
                expect(form.name).toBeTruthy();
                expect(form.description).toBeTruthy();
                const ids = inputs.map(field => field.id);
                expect(ids.every(Boolean)).toBe(true);
                expect(new Set(ids).size).toBe(ids.length);
            });

            it("labels every input and uses only string dropdown options", () => {
                for (const field of inputs) {
                    expect(field.attributes?.label, field.id).toBeTruthy();
                    for (const option of field.attributes?.options ?? []) {
                        const value = typeof option === "object" && option !== null ? (option as { label?: unknown }).label : option;
                        expect(typeof value, `${field.id}: ${String(value)}`).toBe("string");
                    }
                }
            });

            it("asks reporters not to paste secrets", () => {
                expect(inputs.some(field => field.id === "safety" && field.type === "checkboxes")).toBe(true);
            });
        });
    }

    it("collects checkable acceptance criteria in every form that reports a problem or asks for a feature", () => {
        for (const name of forms) {
            const criteria = load(name).body.find(field => field.id === "criteria");
            expect(criteria?.validations?.required, name).toBe(true);
        }
    });

    it("every form the report button can open accepts the shared HTML as optional fields", () => {
        for (const name of ["access_problem.yml", "bug_report.yml", "rendering_bug.yml"]) {
            for (const id of ["before_html", "after_html"]) {
                const field = load(name).body.find(f => f.id === id);
                expect(field, `${name} ${id}`).toBeTruthy();
                expect(field?.validations?.required, `${name} ${id}`).not.toBe(true);
            }
        }
    });

    it("rendering and button forms collect what the helper needs to reproduce offline", () => {
        const ids = (name: string) => load(name).body.map(field => field.id);
        expect(ids("rendering_bug.yml")).toEqual(expect.arrayContaining(["urls", "kind", "before_html", "after_html", "actual", "criteria"]));
        expect(ids("missing_button.yml")).toEqual(expect.arrayContaining(["urls", "layout", "dom_snippet", "criteria"]));
        expect(ids("access_problem.yml")).toEqual(expect.arrayContaining(["urls", "probe", "visibility", "criteria"]));
    });
});
