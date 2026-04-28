import type Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb } from "../test-utils/db.js";
import { upsertCharacter } from "../db/repo.js";
import { simJobs } from "../db/schema.js";
import { sampleCharacter as sample } from "../test-utils/factories.js";
import { backfillWowaudit } from "./backfill.js";
import type { Uploader } from "./upload.js";

function rawSqlite(db: ReturnType<typeof makeTestDb>): Database.Database {
    return (db as unknown as { $client: Database.Database }).$client;
}

function insertDoneJob(
    db: ReturnType<typeof makeTestDb>,
    opts: { characterId: number; reportUrl?: string | null; alreadyUploaded?: boolean },
): number {
    return db
        .insert(simJobs)
        .values({
            characterId: opts.characterId,
            simcSnapshot: "raw",
            status: "done",
            reportUrl: opts.reportUrl === undefined ? "https://x/r/abc" : opts.reportUrl,
            wowauditUploadedAt: opts.alreadyUploaded ? new Date() : null,
        })
        .returning({ id: simJobs.id })
        .get().id;
}

describe("backfillWowaudit", () => {
    it("uploads only done jobs that haven't been uploaded yet and stamps them", async () => {
        const db = makeTestDb();
        const c = upsertCharacter(db, "u1", sample(), "raw");
        const fresh = insertDoneJob(db, { characterId: c.id });
        insertDoneJob(db, { characterId: c.id, alreadyUploaded: true });

        const uploader: Uploader = vi.fn(async () => ({ uploaded: true }));
        const r = await backfillWowaudit(db, uploader);
        expect(r).toEqual({ uploaded: 1, failed: 0, skipped: 0 });
        expect(uploader).toHaveBeenCalledTimes(1);

        const stamped = db.select().from(simJobs).where(eq(simJobs.id, fresh)).get();
        expect(stamped?.wowauditUploadedAt).toBeInstanceOf(Date);
    });

    it("ignores non-done statuses", async () => {
        const db = makeTestDb();
        const c = upsertCharacter(db, "u1", sample(), "raw");
        // Queued / running / failed / cancelled — none should be picked up.
        for (const status of ["queued", "running", "failed", "cancelled"] as const) {
            db.insert(simJobs)
                .values({
                    characterId: c.id,
                    simcSnapshot: "raw",
                    status,
                    reportUrl: status === "failed" ? "https://x/r/zz" : null,
                })
                .run();
        }
        const uploader: Uploader = vi.fn(async () => ({ uploaded: true }));
        const r = await backfillWowaudit(db, uploader);
        expect(r).toEqual({ uploaded: 0, failed: 0, skipped: 0 });
        expect(uploader).not.toHaveBeenCalled();
    });

    it("counts uploader failures as 'failed' and leaves the row unstamped", async () => {
        const db = makeTestDb();
        const c = upsertCharacter(db, "u1", sample(), "raw");
        const id = insertDoneJob(db, { characterId: c.id });
        const uploader: Uploader = vi.fn(async () => ({ uploaded: false }));
        const r = await backfillWowaudit(db, uploader);
        expect(r).toEqual({ uploaded: 0, failed: 1, skipped: 0 });
        const row = db.select().from(simJobs).where(eq(simJobs.id, id)).get();
        expect(row?.wowauditUploadedAt).toBe(null);
    });

    it("counts orphaned jobs (character missing) as skipped", async () => {
        const db = makeTestDb();
        upsertCharacter(db, "u1", sample(), "raw");
        // Sidestep the FK cascade so we can plant a job whose character row
        // has gone missing (mirrors a real-world stale-row scenario).
        const sqlite = rawSqlite(db);
        sqlite.pragma("foreign_keys = OFF");
        sqlite
            .prepare(
                "INSERT INTO sim_jobs (character_id, status, simc_snapshot, report_url) VALUES (?, 'done', 'raw', ?)",
            )
            .run(9999, "https://x/r/orphan");
        sqlite.pragma("foreign_keys = ON");

        const uploader: Uploader = vi.fn(async () => ({ uploaded: true }));
        const r = await backfillWowaudit(db, uploader);
        expect(r.skipped).toBe(1);
        expect(uploader).not.toHaveBeenCalled();
    });

    it("counts done jobs with a null reportUrl as skipped", async () => {
        const db = makeTestDb();
        const c = upsertCharacter(db, "u1", sample(), "raw");
        insertDoneJob(db, { characterId: c.id, reportUrl: null });
        const uploader: Uploader = vi.fn(async () => ({ uploaded: true }));
        const r = await backfillWowaudit(db, uploader);
        // The SQL filter (`isNotNull(reportUrl)`) excludes this row outright,
        // so it doesn't even count as skipped.
        expect(r).toEqual({ uploaded: 0, failed: 0, skipped: 0 });
        expect(uploader).not.toHaveBeenCalled();
    });
});
