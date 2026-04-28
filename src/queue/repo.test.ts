import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb } from "../test-utils/db.js";
import { upsertCharacter, addCharacterRoster } from "../db/repo.js";
import { characters, simJobs } from "../db/schema.js";
import {
    cancelJob,
    claimNextJob,
    enqueueAll,
    enqueueForCharacter,
    enqueueForOwner,
    jobsCountedTowardCap,
    markDone,
    markFailed,
    markWowauditUploaded,
    queueStatus,
    requeueStuckRunning,
} from "./repo.js";
import { sampleCharacter as sample } from "../test-utils/factories.js";

describe("enqueueForOwner / enqueueAll", () => {
    it("skips characters with no simc and counts the rest", () => {
        const db = makeTestDb();
        upsertCharacter(db, "u1", sample({ name: "A" }), "raw");
        upsertCharacter(db, "u1", sample({ name: "B", spec: "marksmanship" }), "raw");
        addCharacterRoster(db, {
            discordId: "u1",
            name: "C",
            realm: "r",
            region: "us",
            className: "mage",
            specs: ["fire"],
        });
        const r = enqueueForOwner(db, "u1");
        expect(r.enqueued).toBe(2);
        expect(r.skippedNoSimc).toBe(1);
        expect(r.skippedHealer).toBe(0);
        expect(r.jobIds).toHaveLength(2);
    });

    it("skips healer specs and reports them separately", () => {
        const db = makeTestDb();
        upsertCharacter(db, "u1", sample({ name: "Bowzo" }), "raw");
        upsertCharacter(
            db,
            "u1",
            sample({ name: "Healz", className: "priest", spec: "discipline" }),
            "raw",
        );
        upsertCharacter(
            db,
            "u1",
            sample({ name: "Sham", className: "shaman", spec: "restoration" }),
            "raw",
        );
        const r = enqueueForOwner(db, "u1");
        expect(r.enqueued).toBe(1);
        expect(r.skippedNoSimc).toBe(0);
        expect(r.skippedHealer).toBe(2);
    });

    it("enqueueAll covers all owners", () => {
        const db = makeTestDb();
        upsertCharacter(db, "u1", sample({ name: "A" }), "raw");
        upsertCharacter(db, "u2", sample({ name: "B" }), "raw");
        const r = enqueueAll(db);
        expect(r.enqueued).toBe(2);
        expect(r.skippedHealer).toBe(0);
    });
});

describe("enqueueForCharacter", () => {
    it("returns empty result when the character doesn't exist", () => {
        const db = makeTestDb();
        const r = enqueueForCharacter(db, 9999);
        expect(r).toEqual({
            enqueued: 0,
            skippedNoSimc: 0,
            skippedHealer: 0,
            skippedDuplicate: 0,
            jobIds: [],
        });
    });

    it("skips when character has no simc", () => {
        const db = makeTestDb();
        addCharacterRoster(db, {
            discordId: "u1",
            name: "C",
            realm: "r",
            region: "us",
            className: "mage",
            specs: ["fire"],
        });
        const owner = db.select().from(characters).all()[0]!;
        const r = enqueueForCharacter(db, owner.id);
        expect(r.enqueued).toBe(0);
        expect(r.skippedNoSimc).toBe(1);
    });

    it("skips healer specs", () => {
        const db = makeTestDb();
        const c = upsertCharacter(
            db,
            "u1",
            sample({ name: "Healz", className: "priest", spec: "discipline" }),
            "raw",
        );
        const r = enqueueForCharacter(db, c.id);
        expect(r.enqueued).toBe(0);
        expect(r.skippedHealer).toBe(1);
    });

    it("enqueues a single job for a valid non-healer character", () => {
        const db = makeTestDb();
        const c = upsertCharacter(db, "u1", sample(), "raw");
        const r = enqueueForCharacter(db, c.id);
        expect(r.enqueued).toBe(1);
        expect(r.jobIds).toHaveLength(1);
    });

    it("skips when the latest job is queued with the same simc snapshot", () => {
        const db = makeTestDb();
        const c = upsertCharacter(db, "u1", sample(), "raw");
        const r1 = enqueueForCharacter(db, c.id);
        expect(r1.enqueued).toBe(1);
        const r2 = enqueueForCharacter(db, c.id);
        expect(r2.enqueued).toBe(0);
        expect(r2.skippedDuplicate).toBe(1);
    });

    it("skips when the latest job is done with the same simc snapshot", () => {
        const db = makeTestDb();
        const c = upsertCharacter(db, "u1", sample(), "raw");
        const r1 = enqueueForCharacter(db, c.id);
        markDone(db, r1.jobIds[0]!, "https://x/r/abc");
        const r2 = enqueueForCharacter(db, c.id);
        expect(r2.skippedDuplicate).toBe(1);
    });

    it("re-enqueues when the latest job failed", () => {
        const db = makeTestDb();
        const c = upsertCharacter(db, "u1", sample(), "raw");
        const r1 = enqueueForCharacter(db, c.id);
        markFailed(db, r1.jobIds[0]!, "boom");
        const r2 = enqueueForCharacter(db, c.id);
        expect(r2.enqueued).toBe(1);
    });

    it("re-enqueues when the latest job was cancelled", () => {
        const db = makeTestDb();
        const c = upsertCharacter(db, "u1", sample(), "raw");
        const r1 = enqueueForCharacter(db, c.id);
        cancelJob(db, r1.jobIds[0]!);
        const r2 = enqueueForCharacter(db, c.id);
        expect(r2.enqueued).toBe(1);
    });

    it("re-enqueues when the simc snapshot has changed since the last done job", () => {
        const db = makeTestDb();
        const c = upsertCharacter(db, "u1", sample(), "old-simc");
        const r1 = enqueueForCharacter(db, c.id);
        markDone(db, r1.jobIds[0]!, "https://x/r/abc");
        upsertCharacter(db, "u1", sample(), "new-simc");
        const r2 = enqueueForCharacter(db, c.id);
        expect(r2.enqueued).toBe(1);
    });
});

describe("claimNextJob / markDone / markFailed", () => {
    it("returns null when no queued jobs", () => {
        const db = makeTestDb();
        expect(claimNextJob(db)).toBe(null);
    });

    it("claims FIFO and transitions queued -> running -> done", () => {
        const db = makeTestDb();
        const c = upsertCharacter(db, "u1", sample(), "raw");
        const { jobIds } = enqueueForOwner(db, "u1");
        // Add a second job for FIFO check.
        db.insert(simJobs).values({ characterId: c.id, simcSnapshot: "raw" }).run();

        const first = claimNextJob(db);
        expect(first?.id).toBe(jobIds[0]);
        expect(first?.status).toBe("running");

        markDone(db, first!.id, "https://example.com/r/abc");
        const row = db.select().from(simJobs).where(eq(simJobs.id, first!.id)).get();
        expect(row?.status).toBe("done");
        expect(row?.reportUrl).toBe("https://example.com/r/abc");

        const second = claimNextJob(db);
        expect(second?.id).not.toBe(first!.id);
        markFailed(db, second!.id, "boom");
        const row2 = db.select().from(simJobs).where(eq(simJobs.id, second!.id)).get();
        expect(row2?.status).toBe("failed");
        expect(row2?.error).toBe("boom");
    });
});

describe("markWowauditUploaded", () => {
    it("stamps wowauditUploadedAt on the given job", () => {
        const db = makeTestDb();
        upsertCharacter(db, "u1", sample(), "raw");
        const { jobIds } = enqueueForOwner(db, "u1");
        markDone(db, jobIds[0]!, "https://x/r/abc");
        const when = new Date("2026-04-28T12:00:00Z");
        markWowauditUploaded(db, jobIds[0]!, when);
        const row = db.select().from(simJobs).where(eq(simJobs.id, jobIds[0]!)).get();
        expect(row?.wowauditUploadedAt?.toISOString()).toBe(when.toISOString());
    });

    it("uses now() when no timestamp is given", () => {
        const db = makeTestDb();
        upsertCharacter(db, "u1", sample(), "raw");
        const { jobIds } = enqueueForOwner(db, "u1");
        markDone(db, jobIds[0]!, "u");
        const before = Date.now();
        markWowauditUploaded(db, jobIds[0]!);
        const row = db.select().from(simJobs).where(eq(simJobs.id, jobIds[0]!)).get();
        expect(row?.wowauditUploadedAt?.getTime()).toBeGreaterThanOrEqual(before - 1000);
    });
});

describe("cancelJob", () => {
    it("cancels only queued jobs", () => {
        const db = makeTestDb();
        upsertCharacter(db, "u1", sample(), "raw");
        const { jobIds } = enqueueForOwner(db, "u1");
        expect(cancelJob(db, jobIds[0]!)).toBe(true);
        expect(cancelJob(db, jobIds[0]!)).toBe(false);
        expect(cancelJob(db, 9999)).toBe(false);
    });
});

describe("requeueStuckRunning", () => {
    it("flips running back to queued", () => {
        const db = makeTestDb();
        upsertCharacter(db, "u1", sample(), "raw");
        const { jobIds } = enqueueForOwner(db, "u1");
        claimNextJob(db);
        expect(requeueStuckRunning(db)).toBe(1);
        const row = db.select().from(simJobs).where(eq(simJobs.id, jobIds[0]!)).get();
        expect(row?.status).toBe("queued");
        expect(row?.startedAt).toBe(null);
    });
});

describe("queueStatus / jobsCountedTowardCap", () => {
    it("aggregates counts and returns recent jobs", () => {
        const db = makeTestDb();
        upsertCharacter(db, "u1", sample(), "raw");
        const { jobIds } = enqueueForOwner(db, "u1");
        const j = claimNextJob(db);
        markDone(db, j!.id, "u");

        // Add a queued one
        upsertCharacter(db, "u2", sample({ name: "Z" }), "raw");
        enqueueForOwner(db, "u2");

        const since = new Date(Date.now() - 60_000);
        const status = queueStatus(db, since);
        expect(status.queued).toBe(1);
        expect(status.running).toBe(0);
        expect(status.doneToday).toBe(1);
        expect(status.failedToday).toBe(0);
        expect(status.recent.length).toBeGreaterThan(0);

        expect(jobsCountedTowardCap(db, since)).toBe(1);
        // Far in the past — still counts
        expect(jobsCountedTowardCap(db, new Date(0))).toBe(1);
        // In the future — counts none
        expect(jobsCountedTowardCap(db, new Date(Date.now() + 60_000))).toBe(0);

        // Sanity: the original job id is the done one
        const done = db.select().from(simJobs).where(eq(simJobs.id, jobIds[0]!)).get();
        expect(done?.status).toBe("done");
    });

    it("handles empty queues gracefully", () => {
        const db = makeTestDb();
        const status = queueStatus(db, new Date());
        expect(status).toEqual({
            queued: 0,
            running: 0,
            doneToday: 0,
            failedToday: 0,
            recent: [],
        });
    });
});
