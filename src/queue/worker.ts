import { setTimeout as sleep } from "node:timers/promises";
import type { Db } from "../db/client.js";
import type { SimJob } from "../db/schema.js";
import { truncate } from "../util/format.js";
import { log } from "../util/log.js";
import { evaluateGate, jitterDelayMs, utcDayStart, type PacingConfig } from "./pacing.js";
import {
    claimNextJob,
    jobsCountedTowardCap,
    markDone,
    markFailed,
    requeueStuckRunning,
} from "./repo.js";

export type ExecResult =
    | { ok: true; reportUrl: string }
    | { ok: false; error: string };

export type Executor = (job: SimJob) => Promise<ExecResult>;

export type WorkerHandle = {
    pause(): void;
    resume(): void;
    isPaused(): boolean;
    /** Wake the loop early so a manual enqueue doesn't have to wait out the pacing delay. */
    poke(): void;
    stop(): Promise<void>;
};

export type WorkerCallbacks = {
    notify?: (message: string) => Promise<void>;
    onJobChange?: () => void;
    /**
     * Fired after a job is marked done with a report URL. Used by wowaudit upload.
     * Errors are caught and logged here; they don't fail the sim itself.
     */
    onJobDone?: (input: { jobId: number; characterId: number; reportUrl: string }) => Promise<void>;
};

const IDLE_POLL_MS = 30_000;
const FAILURE_AUTO_PAUSE_THRESHOLD = 3;

export function startWorker(
    db: Db,
    cfg: PacingConfig,
    executor: Executor,
    {
        notify = async () => {},
        onJobChange = () => {},
        onJobDone = async () => {},
    }: WorkerCallbacks = {},
): WorkerHandle {
    let paused = false;
    let stopped = false;
    let wake: (() => void) | null = null;
    let consecutiveFailures = 0;

    const requeued = requeueStuckRunning(db);
    if (requeued > 0) log.warn({ requeued }, "requeued jobs left in 'running' from prior run");

    const waitForWake = (ms: number): Promise<void> =>
        new Promise((resolve) => {
            let done = false;
            const timer = setTimeout(() => {
                if (done) return;
                done = true;
                wake = null;
                resolve();
            }, ms);
            wake = () => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                wake = null;
                resolve();
            };
        });

    const loop = async (): Promise<void> => {
        log.info({ cfg }, "sim worker started");
        while (!stopped) {
            try {
                if (paused) {
                    await waitForWake(IDLE_POLL_MS);
                    continue;
                }

                const now = new Date();
                const doneToday = jobsCountedTowardCap(db, utcDayStart(now));
                const gate = evaluateGate(cfg, now, doneToday);
                if (gate.gate === "wait") {
                    const waitMs = Math.max(1_000, gate.resumeAtMs - now.getTime());
                    log.info({ reason: gate.reason, waitMs }, "worker gated; sleeping");
                    await waitForWake(Math.min(waitMs, IDLE_POLL_MS));
                    continue;
                }

                const job = claimNextJob(db);
                if (!job) {
                    await waitForWake(IDLE_POLL_MS);
                    continue;
                }
                onJobChange();

                log.info({ jobId: job.id, characterId: job.characterId }, "running job");
                let result: ExecResult;
                try {
                    result = await executor(job);
                } catch (err) {
                    log.error({ err, jobId: job.id }, "executor threw");
                    result = { ok: false, error: String(err instanceof Error ? err.message : err) };
                }

                if (result.ok) {
                    markDone(db, job.id, result.reportUrl);
                    log.info({ jobId: job.id, url: result.reportUrl }, "job done");
                    consecutiveFailures = 0;
                    try {
                        await onJobDone({
                            jobId: job.id,
                            characterId: job.characterId,
                            reportUrl: result.reportUrl,
                        });
                    } catch (err) {
                        log.error({ err, jobId: job.id }, "onJobDone hook threw");
                    }
                } else {
                    markFailed(db, job.id, result.error);
                    log.warn({ jobId: job.id, error: result.error }, "job failed");
                    consecutiveFailures++;
                    if (!paused && consecutiveFailures >= FAILURE_AUTO_PAUSE_THRESHOLD) {
                        paused = true;
                        log.error(
                            { consecutiveFailures },
                            "worker auto-paused after consecutive failures",
                        );
                        notify(
                            `:rotating_light: Sim worker auto-paused after **${consecutiveFailures}** consecutive failures.\n` +
                                `Last error (job \`#${job.id}\`, character ${job.characterId}): \`\`\`${truncate(result.error, 500)}\`\`\`\n` +
                                `Investigate Raidbots / our selectors, then \`/sim resume\` to continue.`,
                        ).catch((err) => log.warn({ err }, "auto-pause notify failed"));
                    }
                }
                onJobChange();

                await waitForWake(jitterDelayMs(cfg));
            } catch (err) {
                log.error({ err }, "worker loop iteration crashed; backing off");
                await sleep(5_000);
            }
        }
        log.info("sim worker stopped");
    };

    loop().catch((err) => log.fatal({ err }, "worker loop exited unexpectedly"));

    return {
        pause: () => {
            paused = true;
            log.info("worker paused");
        },
        resume: () => {
            paused = false;
            consecutiveFailures = 0;
            log.info("worker resumed");
            wake?.();
        },
        isPaused: () => paused,
        poke: () => wake?.(),
        stop: async () => {
            stopped = true;
            wake?.();
        },
    };
}

export const stubExecutor: Executor = async (job) => {
    await sleep(2_000);
    return {
        ok: true,
        reportUrl: `https://www.raidbots.com/simbot/report/STUB-${job.id}`,
    };
};
