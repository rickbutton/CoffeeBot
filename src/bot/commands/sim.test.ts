import { describe, expect, it, vi } from "vitest";
import { makeTestDb } from "../../test-utils/db.js";
import { upsertCharacter } from "../../db/repo.js";
import { simJobs } from "../../db/schema.js";
import { handleSimCommand } from "./sim.js";
import type { WorkerHandle } from "../../queue/worker.js";
import type { SimcCharacter } from "../../parser/simc.js";

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

function makeWorker(overrides: Partial<WorkerHandle> = {}): WorkerHandle {
    return {
        pause: vi.fn(),
        resume: vi.fn(),
        isPaused: () => false,
        poke: vi.fn(),
        stop: async () => {},
        ...overrides,
    };
}

function makeInteraction(opts: {
    sub: string;
    userId?: string;
    options?: Record<string, unknown>;
    targetUser?: { id: string };
    client?: unknown;
}) {
    const reply = vi.fn<(opts: unknown) => Promise<undefined>>(async () => undefined);
    const deferReply = vi.fn<(opts?: unknown) => Promise<undefined>>(async () => undefined);
    const editReply = vi.fn<(opts: unknown) => Promise<undefined>>(async () => undefined);
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
        await handleSimCommand(i as never, db, makeWorker(), new Set(["admin"]), 7);
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
        await handleSimCommand(i as never, db, worker, new Set(["admin"]), 7);
        expect(worker.poke).toHaveBeenCalled();
        const r = i.reply.mock.calls[0]![0] as { content: string };
        expect(r.content).toMatch(/Enqueued/);
    });

    it("run reports no characters when target has none", async () => {
        const db = makeTestDb();
        const i = makeInteraction({ sub: "run", targetUser: { id: "ghost" } });
        await handleSimCommand(i as never, db, makeWorker(), new Set(["admin"]), 7);
        const r = i.reply.mock.calls[0]![0] as { content: string };
        expect(r.content).toMatch(/has no stored characters/);
    });

    it("run enqueues for the target", async () => {
        const db = makeTestDb();
        upsertCharacter(db, "u1", sample(), "raw");
        const i = makeInteraction({ sub: "run", targetUser: { id: "u1" } });
        await handleSimCommand(i as never, db, makeWorker(), new Set(["admin"]), 7);
        const r = i.reply.mock.calls[0]![0] as { content: string };
        expect(r.content).toMatch(/Enqueued \*\*1\*\*/);
    });

    it("status renders even with no jobs", async () => {
        const db = makeTestDb();
        const i = makeInteraction({ sub: "status" });
        await handleSimCommand(i as never, db, makeWorker(), new Set(["admin"]), 7);
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
                raidbotsUrl: "https://x/r/abc",
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
        await handleSimCommand(i as never, db, worker, new Set(["admin"]), 7);
        const r = i.reply.mock.calls[0]![0] as { content: string };
        expect(r.content).toMatch(/paused/);
        expect(r.content).toMatch(/raidbots\.com|x\/r\/abc/);
    });

    it("pause and resume call worker", async () => {
        const db = makeTestDb();
        const worker = makeWorker();
        const ip = makeInteraction({ sub: "pause" });
        await handleSimCommand(ip as never, db, worker, new Set(["admin"]), 7);
        expect(worker.pause).toHaveBeenCalled();
        const ir = makeInteraction({ sub: "resume" });
        await handleSimCommand(ir as never, db, worker, new Set(["admin"]), 7);
        expect(worker.resume).toHaveBeenCalled();
    });

    it("cancel reports success and failure", async () => {
        const db = makeTestDb();
        upsertCharacter(db, "u1", sample(), "raw");
        // Enqueue manually so we know the job id.
        const r1 = (await import("../../queue/repo.js")).enqueueForOwner(db, "u1");
        const ok = makeInteraction({ sub: "cancel", options: { id: r1.jobIds[0] } });
        await handleSimCommand(ok as never, db, makeWorker(), new Set(["admin"]), 7);
        const okReply = ok.reply.mock.calls[0]![0] as { content: string };
        expect(okReply.content).toMatch(/Cancelled/);

        const fail = makeInteraction({ sub: "cancel", options: { id: 9999 } });
        await handleSimCommand(fail as never, db, makeWorker(), new Set(["admin"]), 7);
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
        await handleSimCommand(i as never, db, makeWorker(), new Set(["admin"]), 7);
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
        await handleSimCommand(i as never, db, makeWorker(), new Set(["admin"]), 7);
        const r = i.editReply.mock.calls[0]![0] as { content: string };
        expect(r.content).toMatch(/Skipped/);
    });
});
