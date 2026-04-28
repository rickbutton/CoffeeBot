import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb } from "../test-utils/db.js";
import { upsertCharacter, addCharacterRoster } from "../db/repo.js";
import { simJobs } from "../db/schema.js";
import {
    cancelJob,
    claimNextJob,
    enqueueAll,
    enqueueForOwner,
    jobsCountedTowardCap,
    markDone,
    markFailed,
    queueStatus,
    requeueStuckRunning,
} from "./repo.js";
import type { SimcCharacter } from "../parser/simc.js";

const sample = (overrides: Partial<SimcCharacter> = {}): SimcCharacter => ({
    className: "hunter",
    classDisplay: "Hunter",
    name: "Bowzo",
    region: "us",
    realm: "area-52",
    spec: "beast_mastery",
    level: 80,
    race: "blood_elf",
    ...overrides,
} as SimcCharacter);

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
        expect(r.jobIds).toHaveLength(2);
    });

    it("enqueueAll covers all owners", () => {
        const db = makeTestDb();
        upsertCharacter(db, "u1", sample({ name: "A" }), "raw");
        upsertCharacter(db, "u2", sample({ name: "B" }), "raw");
        const r = enqueueAll(db);
        expect(r.enqueued).toBe(2);
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

        markDone(db, first!.id, "https://example.com/r/abc", "abc");
        const row = db.select().from(simJobs).where(eq(simJobs.id, first!.id)).get();
        expect(row?.status).toBe("done");
        expect(row?.raidbotsUrl).toBe("https://example.com/r/abc");

        const second = claimNextJob(db);
        expect(second?.id).not.toBe(first!.id);
        markFailed(db, second!.id, "boom");
        const row2 = db.select().from(simJobs).where(eq(simJobs.id, second!.id)).get();
        expect(row2?.status).toBe("failed");
        expect(row2?.error).toBe("boom");
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
        markDone(db, j!.id, "u", "rid");

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
