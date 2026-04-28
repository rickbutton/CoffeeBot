import { describe, expect, it } from "vitest";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "./client.js";

describe("openDb", () => {
    it("creates the parent directory for a file-backed db", () => {
        const root = mkdtempSync(join(tmpdir(), "ddb-"));
        const path = join(root, "nested", "subdir", "test.db");
        const db = openDb(path);
        try {
            expect(existsSync(path)).toBe(true);
        } finally {
            // Close the underlying sqlite handle before cleanup (Windows file locking).
            (db as unknown as { $client: { close(): void } }).$client.close();
            rmSync(root, { recursive: true, force: true });
        }
    });

    it("opens an in-memory db without touching the filesystem", () => {
        const db = openDb(":memory:");
        expect(db).toBeDefined();
    });
});
