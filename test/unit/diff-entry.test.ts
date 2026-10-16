import { describe, expect, it } from "vitest";
import { findDiffEntry } from "../../src/core/diff-entry";

const stream = (chunks: string[]) => new ReadableStream<Uint8Array>({
    start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
    }
});

const DIFF = [
    "diff --git a/Makefile b/Makefile", "index 1..2 100644", "--- a/Makefile", "+++ b/Makefile", "@@ -1 +1 @@", "-x", "+y",
    "diff --git a/docs/old name.html b/docs/new name.html", "similarity index 88%", "rename from docs/old name.html", "rename to docs/new name.html", "index 3..4 100644", "--- a/docs/old name.html", "+++ b/docs/new name.html", "@@ -1 +1 @@", "-a", "+b",
    "diff --git a/site/fresh.html b/site/fresh.html", "new file mode 100644", "index 0000000..5", "--- /dev/null", "+++ b/site/fresh.html", "@@ -0,0 +1 @@", "+a",
    "diff --git a/site/gone.html b/site/gone.html", "deleted file mode 100644", "index 6..0000000", "--- a/site/gone.html", "+++ /dev/null", "@@ -1 +0,0 @@", "-a",
    "diff --git a/site/same.html b/site/same.html", "index 7..8 100644", "--- a/site/same.html", "+++ b/site/same.html", "@@ -1 +1 @@", "-a", "+b",
    "diff --git a/img/pic.png b/img/pic.png", "new file mode 100644", "index 0..9", "Binary files /dev/null and b/img/pic.png differ"
].join("\n") + "\n";

describe("findDiffEntry", () => {
    it("recognises modified, added, removed and renamed files", async () => {
        expect(await findDiffEntry(stream([DIFF]), "site/same.html")).toEqual({ status: "modified" });
        expect(await findDiffEntry(stream([DIFF]), "site/fresh.html")).toEqual({ status: "added" });
        expect(await findDiffEntry(stream([DIFF]), "site/gone.html")).toEqual({ status: "removed" });
        expect(await findDiffEntry(stream([DIFF]), "docs/new name.html")).toEqual({ status: "renamed", previous: "docs/old name.html" });
    });

    it("recognises a binary new file", async () => {
        expect(await findDiffEntry(stream([DIFF]), "img/pic.png")).toEqual({ status: "added" });
    });

    it("does not mistake another file whose name merely ends the same way", async () => {
        const tricky = ["diff --git a/foo b/x.html b/foo b/x.html", "deleted file mode 100644", "--- a/foo b/x.html", "+++ /dev/null", "@@ -1 +0,0 @@", "-a",
            "diff --git a/x.html b/x.html", "new file mode 100644", "--- /dev/null", "+++ b/x.html", "@@ -0,0 +1 @@", "+a"].join("\n") + "\n";
        expect(await findDiffEntry(stream([tricky]), "x.html")).toEqual({ status: "added" });
    });

    it("confirms a rename only by its 'rename to' line", async () => {
        const renamed = ["diff --git a/old.html b/x.html", "similarity index 100%", "rename from old.html", "rename to x.html"].join("\n") + "\n";
        expect(await findDiffEntry(stream([renamed]), "x.html")).toEqual({ status: "renamed", previous: "old.html" });
    });

    it("returns null for files that are not in the diff", async () => {
        expect(await findDiffEntry(stream([DIFF]), "nope.html")).toBeNull();
    });

    it("copes with lines split across chunks", async () => {
        const chunks = DIFF.match(/[\s\S]{1,7}/g)!;
        expect(await findDiffEntry(stream(chunks), "docs/new name.html")).toEqual({ status: "renamed", previous: "docs/old name.html" });
    });

    it("stops reading once the entry is complete", async () => {
        let pulled = 0;
        const body = new ReadableStream<Uint8Array>({
            pull(controller) {
                pulled++;
                controller.enqueue(new TextEncoder().encode(pulled === 1 ? DIFF : "diff --git a/zzz b/zzz\n".repeat(1000)));
                if (pulled > 50) controller.close();
            }
        });
        expect(await findDiffEntry(body, "site/gone.html")).toEqual({ status: "removed" });
        expect(pulled).toBeLessThan(5);
    });

    it("gives up after the byte limit", async () => {
        expect(await findDiffEntry(stream(["x".repeat(100), "y".repeat(100)]), "a.html", 50)).toBeNull();
    });
});
