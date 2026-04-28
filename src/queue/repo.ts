import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { characters, simJobs, type SimJob } from "../db/schema.js";

export type EnqueueResult = {
    enqueued: number;
    /** Characters skipped because they're pre-registered but have no simc yet. */
    skippedNoSimc: number;
    jobIds: number[];
};

export function enqueueForOwner(db: Db, discordId: string): EnqueueResult {
    return enqueueRows(
        db,
        db
            .select({ id: characters.id, simc: characters.simc })
            .from(characters)
            .where(eq(characters.discordId, discordId))
            .all(),
    );
}

export function enqueueAll(db: Db): EnqueueResult {
    return enqueueRows(
        db,
        db.select({ id: characters.id, simc: characters.simc }).from(characters).all(),
    );
}

function enqueueRows(db: Db, rows: { id: number; simc: string | null }[]): EnqueueResult {
    const jobIds: number[] = [];
    let skippedNoSimc = 0;
    for (const r of rows) {
        if (r.simc === null) {
            skippedNoSimc++;
            continue;
        }
        const row = db
            .insert(simJobs)
            .values({ characterId: r.id, simcSnapshot: r.simc })
            .returning({ id: simJobs.id })
            .get();
        jobIds.push(row.id);
    }
    return { enqueued: jobIds.length, skippedNoSimc, jobIds };
}

export function claimNextJob(db: Db): SimJob | null {
    return db.transaction((tx) => {
        const next = tx
            .select()
            .from(simJobs)
            .where(eq(simJobs.status, "queued"))
            .orderBy(simJobs.id)
            .limit(1)
            .get();
        if (!next) return null;
        const startedAt = new Date();
        tx.update(simJobs)
            .set({ status: "running", startedAt })
            .where(eq(simJobs.id, next.id))
            .run();
        return { ...next, status: "running", startedAt };
    });
}

export function markDone(
    db: Db,
    jobId: number,
    raidbotsUrl: string,
    raidbotsReportId: string | null,
): void {
    db.update(simJobs)
        .set({
            status: "done",
            raidbotsUrl,
            raidbotsReportId,
            completedAt: new Date(),
            error: null,
        })
        .where(eq(simJobs.id, jobId))
        .run();
}

export function markFailed(db: Db, jobId: number, error: string): void {
    db.update(simJobs)
        .set({ status: "failed", error, completedAt: new Date() })
        .where(eq(simJobs.id, jobId))
        .run();
}

export function cancelJob(db: Db, jobId: number): boolean {
    return (
        db
            .update(simJobs)
            .set({ status: "cancelled", completedAt: new Date() })
            .where(and(eq(simJobs.id, jobId), eq(simJobs.status, "queued")))
            .run().changes > 0
    );
}

export function requeueStuckRunning(db: Db): number {
    return db
        .update(simJobs)
        .set({ status: "queued", startedAt: null })
        .where(eq(simJobs.status, "running"))
        .run().changes;
}

export type QueueStatus = {
    queued: number;
    running: number;
    doneToday: number;
    failedToday: number;
    recent: SimJob[];
};

export function queueStatus(db: Db, since: Date): QueueStatus {
    const live = db
        .select({ status: simJobs.status, n: sql<number>`count(*)` })
        .from(simJobs)
        .where(inArray(simJobs.status, ["queued", "running"]))
        .groupBy(simJobs.status)
        .all();
    const today = db
        .select({ status: simJobs.status, n: sql<number>`count(*)` })
        .from(simJobs)
        .where(and(inArray(simJobs.status, ["done", "failed"]), gte(simJobs.completedAt, since)))
        .groupBy(simJobs.status)
        .all();
    const recent = db
        .select()
        .from(simJobs)
        .orderBy(sql`${simJobs.id} desc`)
        .limit(10)
        .all();
    return {
        queued: live.find((c) => c.status === "queued")?.n ?? 0,
        running: live.find((c) => c.status === "running")?.n ?? 0,
        doneToday: today.find((c) => c.status === "done")?.n ?? 0,
        failedToday: today.find((c) => c.status === "failed")?.n ?? 0,
        recent,
    };
}

// Failed/cancelled jobs don't burn the cap — only successful sims hit raidbots' queue.
export function jobsCountedTowardCap(db: Db, since: Date): number {
    return (
        db
            .select({ n: sql<number>`count(*)` })
            .from(simJobs)
            .where(and(eq(simJobs.status, "done"), gte(simJobs.completedAt, since)))
            .get()?.n ?? 0
    );
}
