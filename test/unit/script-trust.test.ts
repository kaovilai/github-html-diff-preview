import { beforeEach, describe, expect, it } from "vitest";
import { isTrusted, listTrusted, repoKey, trustRepo, untrustAll, untrustRepo } from "../../src/shared/script-trust";

beforeEach(() => localStorage.clear());

describe("script trust", () => {
    it("starts empty and trusts nothing", () => {
        expect(listTrusted()).toEqual([]);
        expect(isTrusted("o", "r")).toBe(false);
    });

    it("remembers a repository, ignoring case, once, in order", () => {
        expect(trustRepo("Acme", "Site")).toBe(true);
        trustRepo("acme", "site");
        trustRepo("a", "b");
        expect(listTrusted()).toEqual(["a/b", "acme/site"]);
        expect(isTrusted("ACME", "SITE")).toBe(true);
        expect(isTrusted("acme", "other")).toBe(false);
        expect(repoKey("Acme", "Site")).toBe("acme/site");
    });

    it("allows one repository only, not its owner's others", () => {
        trustRepo("o", "r");
        expect(isTrusted("o", "r2")).toBe(false);
        expect(isTrusted("o2", "r")).toBe(false);
    });

    it("undoes one repository or all of them", () => {
        trustRepo("o", "r");
        trustRepo("o", "s");
        untrustRepo("O/R");
        expect(listTrusted()).toEqual(["o/s"]);
        untrustAll();
        expect(listTrusted()).toEqual([]);
        expect(localStorage.getItem("trustedScriptRepos")).toBeNull();
    });

    it("ignores corrupt or tampered stored values", () => {
        for (const bad of ["not json", "{}", '["", "a", "a/b/c", "x y/z", 3, null, "ok/ok"]']) {
            localStorage.setItem("trustedScriptRepos", bad);
            expect(listTrusted().every(item => /^[^/\s]+\/[^/\s]+$/.test(item))).toBe(true);
        }
        expect(listTrusted()).toEqual(["ok/ok"]);
    });

    it("reports when the choice cannot be saved", () => {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = () => { throw new Error("denied"); };
        try {
            expect(trustRepo("o", "r")).toBe(false);
        } finally {
            Storage.prototype.setItem = original;
        }
    });
});
