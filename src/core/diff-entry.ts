// Finds one file's entry (added / removed / renamed / modified) in a unified diff, reading only as much of the
// stream as needed. `github.com/<o>/<r>/compare/<a>..<b>.diff` is served to the browser's own login, so this
// gives pull request file status without the REST API.

import type { FileChange } from "../shared/messages";

// Stop reading after this much diff text; the answer is optional, callers fall back to inferring it.
export const MAX_DIFF_BYTES = 32 * 1024 * 1024;

const HEADER = "diff --git ";

export const findDiffEntry = async (body: ReadableStream<Uint8Array>, path: string, maxBytes = MAX_DIFF_BYTES): Promise<FileChange | null> => {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    let total = 0;
    let entry: FileChange | null = null;
    // A header that merely ends with " b/<path>" could belong to another file whose name contains a space, so a
    // renamed file is only confirmed by its "rename to <path>" line. An unrenamed file repeats the path exactly.
    let confirmed = false;

    const reset = () => {
        entry = null;
        confirmed = false;
    };

    // returns true when the entry is complete (its hunks or the next file started)
    const handle = (line: string): boolean => {
        if (line.startsWith(HEADER)) {
            if (entry && confirmed) return true;
            reset();
            if (line === `${HEADER}a/${path} b/${path}`) {
                entry = { status: "modified" };
                confirmed = true;
            } else if (line.startsWith(`${HEADER}a/`) && line.endsWith(` b/${path}`)) {
                entry = { status: "modified" };
            }
            return false;
        }
        if (!entry) return false;
        if (line.startsWith("@@") || line.startsWith("--- ") || line.startsWith("Binary files") || line.startsWith("GIT binary patch")) {
            if (confirmed) return true;
            reset();
            return false;
        }
        if (line.startsWith("new file mode")) entry.status = "added";
        else if (line.startsWith("deleted file mode")) entry.status = "removed";
        else if (line.startsWith("rename from ")) {
            entry.status = "renamed";
            entry.previous = line.slice("rename from ".length);
        } else if (line === `rename to ${path}`) {
            confirmed = true;
        }
        return false;
    };

    const result = (): FileChange | null => (confirmed ? entry : null);

    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.length;
            pending += decoder.decode(value, { stream: true });
            const lines = pending.split("\n");
            pending = lines.pop() ?? "";
            for (const line of lines) {
                if (handle(line)) return result();
            }
            if (total > maxBytes) return result();
        }
        if (pending) handle(pending);
        return result();
    } finally {
        await reader.cancel().catch(() => undefined);
    }
}
