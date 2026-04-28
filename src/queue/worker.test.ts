import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setTimeout as sleep } from "node:timers/promises";
import { makeTestDb } from "../test-utils/db.js";
import { upsertCharacter } from "../db/repo.js";
import { simJobs } from "../db/schema.js";
import { enqueueForOwner } from "./repo.js";
import { startWorker, stubExecutor, type Executor } from "./worker.js";
import type { PacingConfig } from "./pacing.js";
import { sampleCharacter as sample } from "../test-utils/factories.js";

const FAST_CFG: PacingConfig = { minDelaySeconds: 1, maxDelaySeconds: 1, dailyCap: 100 };

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (predicate()) return;
        await sleep(20);
    }
    throw new Error("waitFor timed out");
}

describe("startWorker", () => {
    it("processes a job to done with a passing executor", async () => {
        const db = makeTestDb();
        const c = upsertCharacter(db, "u1", sample(), "raw");
        const { jobIds } = enqueueForOwner(db, "u1");

        const executor: Executor = async () => ({
            ok: true,
            reportUrl: "https://x/r/abc",
        });

        let changes = 0;
        const w = startWorker(db, FAST_CFG, executor, { onJobChange: () => changes++ });
        try {
            await waitFor(() => {
                const row = db.select().from(simJobs).where(eq(simJobs.id, jobIds[0]!)).get();
                return row?.status === "done";
            });
            expect(changes).toBeGreaterThan(0);
            // Sanity: characterId still matches
            const row = db.select().from(simJobs).where(eq(simJobs.id, jobIds[0]!)).get();
            expect(row?.characterId).toBe(c.id);
            expect(row?.reportUrl).toBe("https://x/r/abc");
        } finally {
            await w.stop();
        }
    });

    it("invokes onJobDone with the report URL after a successful job", async () => {
        const db = makeTestDb();
        upsertCharacter(db, "u1", sample(), "raw");
        const { jobIds } = enqueueForOwner(db, "u1");

        const executor: Executor = async () => ({
            ok: true,
            reportUrl: "https://www.raidbots.com/simbot/report/RID42",
        });

        const calls: { jobId: number; reportUrl: string }[] = [];
        const w = startWorker(db, FAST_CFG, executor, {
            onJobDone: async ({ jobId, reportUrl }) => {
                calls.push({ jobId, reportUrl });
            },
        });
        try {
            await waitFor(() => calls.length > 0);
            expect(calls[0]!.jobId).toBe(jobIds[0]);
            expect(calls[0]!.reportUrl).toContain("RID42");
        } finally {
            await w.stop();
        }
    });

    it("logs but does not crash when onJobDone throws", async () => {
        const db = makeTestDb();
        upsertCharacter(db, "u1", sample(), "raw");
        const { jobIds } = enqueueForOwner(db, "u1");

        const executor: Executor = async () => ({
            ok: true,
            reportUrl: "https://www.raidbots.com/simbot/report/x",
        });

        const w = startWorker(db, FAST_CFG, executor, {
            onJobDone: async () => {
                throw new Error("upload exploded");
            },
        });
        try {
            await waitFor(() => {
                const row = db.select().from(simJobs).where(eq(simJobs.id, jobIds[0]!)).get();
                return row?.status === "done";
            });
        } finally {
            await w.stop();
        }
    });

    it("requeues stuck running jobs on startup", async () => {
        const db = makeTestDb();
        const c = upsertCharacter(db, "u1", sample(), "raw");
        // Insert a job already in 'running' as if a previous process crashed.
        const inserted = db
            .insert(simJobs)
            .values({ characterId: c.id, simcSnapshot: "raw", status: "running" })
            .returning({ id: simJobs.id })
            .get();

        const executor: Executor = async () => ({
            ok: true,
            reportUrl: "https://x/r/abc",
        });
        const w = startWorker(db, FAST_CFG, executor);
        try {
            await waitFor(() => {
                const row = db.select().from(simJobs).where(eq(simJobs.id, inserted.id)).get();
                return row?.status === "done";
            });
        } finally {
            await w.stop();
        }
    });

    it("auto-pauses after 3 consecutive failures and notifies", async () => {
        const db = makeTestDb();
        for (let i = 0; i < 3; i++) {
            upsertCharacter(db, "u1", sample({ name: `c${i}` }), "raw");
        }
        const r = (await import("./repo.js")).enqueueForOwner(db, "u1");
        expect(r.enqueued).toBe(3);

        const executor: Executor = async () => {
            throw new Error("boom");
        };
        const messages: string[] = [];
        const w = startWorker(db, FAST_CFG, executor, {
            notify: async (m) => {
                messages.push(m);
            },
        });
        try {
            await waitFor(() => w.isPaused());
            expect(messages.length).toBe(1);
            expect(messages[0]).toMatch(/auto-paused/);
            // resume clears paused flag
            w.resume();
            expect(w.isPaused()).toBe(false);
        } finally {
            await w.stop();
        }
    });

    it("pause/resume/poke can be called without throwing", async () => {
        const db = makeTestDb();
        const w = startWorker(db, FAST_CFG, stubExecutor);
        try {
            w.pause();
            expect(w.isPaused()).toBe(true);
            w.poke();
            w.resume();
            expect(w.isPaused()).toBe(false);
            w.poke();
        } finally {
            await w.stop();
        }
    });

    it("stays paused on the gate when daily cap is reached", async () => {
        const db = makeTestDb();
        const c = upsertCharacter(db, "u1", sample(), "raw");
        // Pre-populate a 'done' job today so the cap is already reached.
        db.insert(simJobs)
            .values({
                characterId: c.id,
                simcSnapshot: "raw",
                status: "done",
                completedAt: new Date(),
            })
            .run();
        const { jobIds } = enqueueForOwner(db, "u1");

        let executed = 0;
        const executor: Executor = async () => {
            executed++;
            return { ok: true, reportUrl: "u" };
        };
        const w = startWorker(db, { ...FAST_CFG, dailyCap: 1 }, executor);
        try {
            await sleep(150);
            const row = db.select().from(simJobs).where(eq(simJobs.id, jobIds[0]!)).get();
            expect(row?.status).toBe("queued");
            expect(executed).toBe(0);
        } finally {
            await w.stop();
        }
    });
});

describe("stubExecutor", () => {
    it("returns ok with stub url after a delay", async () => {
        const job = { id: 7 } as never;
        const r = await stubExecutor(job);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.reportUrl).toContain("STUB-7");
    });
}, 10_000);
