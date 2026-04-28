import { describe, expect, it, vi } from "vitest";
import { makeTestDb } from "../../test-utils/db.js";
import { upsertCharacter } from "../../db/repo.js";
import { simJobs } from "../../db/schema.js";
import { handleSimCommand } from "./sim.js";
import {
    asyncMock,
    makeWorker,
    sampleCharacter as sample,
} from "../../test-utils/factories.js";

function makeInteraction(opts: {
    sub: string;
    userId?: string;
    options?: Record<string, unknown>;
    targetUser?: { id: string };
    client?: unknown;
}) {
    const reply = asyncMock();
    const deferReply = asyncMock();
    const editReply = asyncMock();
    return {
        user: { id: opts.userId ?? "admin" },
        client: opts.client ?? ({ users: { fetch: async () => ({ createDM: async () => ({ send: async () => {} }) }) } }),
        options: {
            getSubcommand: () => opts.sub,
            getUser: () => opts.targetUser ?? { id: "u1" },
            getString: (name: string) => (opts.options?.[name] as string) ?? null,
            getInteger: (name: string) => (opts.options?.[name] as number) ?? 0,
        },
        reply,
        deferReply,
        editReply,
    };
}

describe("handleSimCommand: auth", () => {
    it("rejects non-admins", async () => {
        const db = makeTestDb();
        const i = makeInteraction({ sub: "status", userId: "x" });
        await handleSimCommand(i as never, db, makeWorker(), new Set(["admin"]), 7, null);
        const r = i.reply.mock.calls[0]![0] as { content: string };
        expect(r.content).toMatch(/Admin only/);
    });
});

describe("handleSimCommand subcommands", () => {
    it("run-all enqueues and pokes the worker", async () => {
        const db = makeTestDb();
        upsertCharacter(db, "u1", sample(), "raw");
        const worker = makeWorker();
        const i = makeInteraction({ sub: "run-all" });
        await handleSimCommand(i as never, db, worker, new Set(["admin"]), 7, null);
        expect(worker.poke).toHaveBeenCalled();
        const r = i.reply.mock.calls[0]![0] as { content: string };
        expect(r.content).toMatch(/Enqueued/);
    });

    it("run-all reports skipped healers in the suffix", async () => {
        const db = makeTestDb();
        upsertCharacter(db, "u1", sample(), "raw");
        upsertCharacter(
            db,
            "u1",
            sample({ name: "Healz", className: "priest", spec: "discipline" }),
            "raw",
        );
        const i = makeInteraction({ sub: "run-all" });
        await handleSimCommand(i as never, db, makeWorker(), new Set(["admin"]), 7, null);
        const r = i.reply.mock.calls[0]![0] as { content: string };
        expect(r.content).toMatch(/Enqueued \*\*1\*\*/);
        expect(r.content).toMatch(/healer spec\(s\) — sim manually in QELive/);
    });

    it("run reports no characters when target has none", async () => {
        const db = makeTestDb();
        const i = makeInteraction({ sub: "run", targetUser: { id: "ghost" } });
        await handleSimCommand(i as never, db, makeWorker(), new Set(["admin"]), 7, null);
        const r = i.reply.mock.calls[0]![0] as { content: string };
        expect(r.content).toMatch(/has no stored characters/);
    });

    it("run enqueues for the target", async () => {
        const db = makeTestDb();
        upsertCharacter(db, "u1", sample(), "raw");
        const i = makeInteraction({ sub: "run", targetUser: { id: "u1" } });
        await handleSimCommand(i as never, db, makeWorker(), new Set(["admin"]), 7, null);
        const r = i.reply.mock.calls[0]![0] as { content: string };
        expect(r.content).toMatch(/Enqueued \*\*1\*\*/);
    });

    it("status renders even with no jobs", async () => {
        const db = makeTestDb();
        const i = makeInteraction({ sub: "status" });
        await handleSimCommand(i as never, db, makeWorker(), new Set(["admin"]), 7, null);
        const r = i.reply.mock.calls[0]![0] as { content: string };
        expect(r.content).toMatch(/Worker:/);
        expect(r.content).toMatch(/none/);
    });

    it("status renders recent jobs", async () => {
        const db = makeTestDb();
        const c = upsertCharacter(db, "u1", sample(), "raw");
        db.insert(simJobs)
            .values({
                characterId: c.id,
                simcSnapshot: "raw",
                status: "done",
                reportUrl: "https://x/r/abc",
            })
            .run();
        db.insert(simJobs)
            .values({
                characterId: c.id,
                simcSnapshot: "raw",
                status: "failed",
                error: "boom".repeat(40),
            })
            .run();
        const i = makeInteraction({ sub: "status" });
        const worker = makeWorker({ isPaused: () => true });
        await handleSimCommand(i as never, db, worker, new Set(["admin"]), 7, null);
        const r = i.reply.mock.calls[0]![0] as { content: string };
        expect(r.content).toMatch(/paused/);
        expect(r.content).toMatch(/raidbots\.com|x\/r\/abc/);
        // No wowaudit marker on jobs that weren't uploaded.
        expect(r.content).not.toMatch(/outbox_tray/);
    });

    it("status shows an outbox_tray marker on jobs uploaded to wowaudit", async () => {
        const db = makeTestDb();
        const c = upsertCharacter(db, "u1", sample(), "raw");
        db.insert(simJobs)
            .values({
                characterId: c.id,
                simcSnapshot: "raw",
                status: "done",
                reportUrl: "https://x/r/abc",
                wowauditUploadedAt: new Date(),
            })
            .run();
        const i = makeInteraction({ sub: "status" });
        await handleSimCommand(i as never, db, makeWorker(), new Set(["admin"]), 7, null);
        const r = i.reply.mock.calls[0]![0] as { content: string };
        expect(r.content).toMatch(/outbox_tray/);
    });

    it("pause and resume call worker", async () => {
        const db = makeTestDb();
        const worker = makeWorker();
        const ip = makeInteraction({ sub: "pause" });
        await handleSimCommand(ip as never, db, worker, new Set(["admin"]), 7, null);
        expect(worker.pause).toHaveBeenCalled();
        const ir = makeInteraction({ sub: "resume" });
        await handleSimCommand(ir as never, db, worker, new Set(["admin"]), 7, null);
        expect(worker.resume).toHaveBeenCalled();
    });

    it("cancel reports success and failure", async () => {
        const db = makeTestDb();
        upsertCharacter(db, "u1", sample(), "raw");
        // Enqueue manually so we know the job id.
        const r1 = (await import("../../queue/repo.js")).enqueueForOwner(db, "u1");
        const ok = makeInteraction({ sub: "cancel", options: { id: r1.jobIds[0] } });
        await handleSimCommand(ok as never, db, makeWorker(), new Set(["admin"]), 7, null);
        const okReply = ok.reply.mock.calls[0]![0] as { content: string };
        expect(okReply.content).toMatch(/Cancelled/);

        const fail = makeInteraction({ sub: "cancel", options: { id: 9999 } });
        await handleSimCommand(fail as never, db, makeWorker(), new Set(["admin"]), 7, null);
        const failReply = fail.reply.mock.calls[0]![0] as { content: string };
        expect(failReply.content).toMatch(/isn't queued/);
    });

    it("request-simcs DMs and reports counts", async () => {
        const db = makeTestDb();
        upsertCharacter(db, "u1", sample(), "raw");
        const send = vi.fn(async () => {});
        const client = {
            users: {
                fetch: async () => ({ createDM: async () => ({ send }) }),
            },
        };
        const i = makeInteraction({ sub: "request-simcs", client });
        await handleSimCommand(i as never, db, makeWorker(), new Set(["admin"]), 7, null);
        expect(i.deferReply).toHaveBeenCalled();
        expect(i.editReply).toHaveBeenCalled();
        expect(send).toHaveBeenCalled();
        const r = i.editReply.mock.calls[0]![0] as { content: string };
        expect(r.content).toMatch(/Sent/);
    });

    it("request-simcs reports skipped users when DM fails", async () => {
        const db = makeTestDb();
        upsertCharacter(db, "u1", sample(), "raw");
        const client = {
            users: {
                fetch: async () => {
                    throw new Error("nope");
                },
            },
        };
        const i = makeInteraction({ sub: "request-simcs", client });
        await handleSimCommand(i as never, db, makeWorker(), new Set(["admin"]), 7, null);
        const r = i.editReply.mock.calls[0]![0] as { content: string };
        expect(r.content).toMatch(/Skipped/);
    });

    it("backfill-wowaudit refuses when the uploader is null", async () => {
        const db = makeTestDb();
        const i = makeInteraction({ sub: "backfill-wowaudit" });
        await handleSimCommand(i as never, db, makeWorker(), new Set(["admin"]), 7, null);
        const r = i.reply.mock.calls[0]![0] as { content: string };
        expect(r.content).toMatch(/WOWAUDIT_API_KEY/);
    });

    it("backfill-wowaudit invokes the uploader and reports counts", async () => {
        const db = makeTestDb();
        const c = upsertCharacter(db, "u1", sample(), "raw");
        // One done job needing upload, one already uploaded.
        db.insert(simJobs)
            .values({
                characterId: c.id,
                simcSnapshot: "raw",
                status: "done",
                reportUrl: "https://x/r/needs",
            })
            .run();
        db.insert(simJobs)
            .values({
                characterId: c.id,
                simcSnapshot: "raw",
                status: "done",
                reportUrl: "https://x/r/done",
                wowauditUploadedAt: new Date(),
            })
            .run();

        const uploader = vi.fn(async () => ({ uploaded: true }));
        const i = makeInteraction({ sub: "backfill-wowaudit" });
        await handleSimCommand(i as never, db, makeWorker(), new Set(["admin"]), 7, uploader);
        expect(uploader).toHaveBeenCalledTimes(1);
        expect(i.deferReply).toHaveBeenCalled();
        const r = i.editReply.mock.calls[0]![0] as { content: string };
        expect(r.content).toMatch(/uploaded \*\*1\*\*/);
    });

    it("backfill-wowaudit replies cleanly when there's nothing to do", async () => {
        const db = makeTestDb();
        const uploader = vi.fn(async () => ({ uploaded: true }));
        const i = makeInteraction({ sub: "backfill-wowaudit" });
        await handleSimCommand(i as never, db, makeWorker(), new Set(["admin"]), 7, uploader);
        expect(uploader).not.toHaveBeenCalled();
        const r = i.editReply.mock.calls[0]![0] as { content: string };
        expect(r.content).toMatch(/Nothing to backfill/);
    });
});
