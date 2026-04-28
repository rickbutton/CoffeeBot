import { describe, expect, it } from "vitest";
import { makeTestDb } from "../../test-utils/db.js";
import { upsertCharacter } from "../../db/repo.js";
import { handleCharactersCommand } from "./characters.js";
import { asyncMock, sampleCharacter as sample } from "../../test-utils/factories.js";

function makeInteraction(opts: {
    sub: string;
    userId?: string;
    targetUser?: { id: string } | null;
    options?: Record<string, unknown>;
}) {
    const reply = asyncMock();
    return {
        user: { id: opts.userId ?? "u1" },
        options: {
            getSubcommand: () => opts.sub,
            getUser: (_name: string, _required?: boolean) => opts.targetUser ?? null,
            getString: (name: string, _required?: boolean) =>
                (opts.options?.[name] as string) ?? "",
            getInteger: (name: string, _required?: boolean) =>
                (opts.options?.[name] as number) ?? 0,
        },
        reply,
    };
}

describe("handleCharactersCommand: list", () => {
    it("lists own characters; empty message when none", async () => {
        const db = makeTestDb();
        const i = makeInteraction({ sub: "list" });
        await handleCharactersCommand(i as never, db, new Set());
        const r = i.reply.mock.calls[0]![0] as { content: string };
        expect(r.content).toContain("haven't stored any characters");
    });

    it("lists own characters when present", async () => {
        const db = makeTestDb();
        upsertCharacter(db, "u1", sample(), "raw");
        const i = makeInteraction({ sub: "list" });
        await handleCharactersCommand(i as never, db, new Set());
        const r = i.reply.mock.calls[0]![0] as { content: string };
        expect(r.content).toContain("Your characters");
        expect(r.content).toContain("Bowzo");
    });

    it("denies listing others' characters when not admin", async () => {
        const db = makeTestDb();
        const i = makeInteraction({ sub: "list", userId: "u1", targetUser: { id: "u2" } });
        await handleCharactersCommand(i as never, db, new Set());
        const r = i.reply.mock.calls[0]![0] as { content: string };
        expect(r.content).toMatch(/Only admins/);
    });

    it("admins can list another user's characters; reports empty", async () => {
        const db = makeTestDb();
        const i = makeInteraction({
            sub: "list",
            userId: "admin",
            targetUser: { id: "u2" },
        });
        await handleCharactersCommand(i as never, db, new Set(["admin"]));
        const r = i.reply.mock.calls[0]![0] as { content: string };
        expect(r.content).toContain("No characters stored for");
    });

    it("admins can list another user's non-empty characters", async () => {
        const db = makeTestDb();
        upsertCharacter(db, "u2", sample(), "raw");
        const i = makeInteraction({
            sub: "list",
            userId: "admin",
            targetUser: { id: "u2" },
        });
        await handleCharactersCommand(i as never, db, new Set(["admin"]));
        const r = i.reply.mock.calls[0]![0] as { content: string };
        expect(r.content).toContain("Characters for");
    });
});

describe("handleCharactersCommand: delete", () => {
    it("deletes when the row belongs to the caller", async () => {
        const db = makeTestDb();
        const c = upsertCharacter(db, "u1", sample(), "raw");
        const i = makeInteraction({ sub: "delete", options: { id: c.id } });
        await handleCharactersCommand(i as never, db, new Set());
        const r = i.reply.mock.calls[0]![0] as { content: string };
        expect(r.content).toMatch(/Deleted/);
    });

    it("returns not-found when row doesn't belong to caller", async () => {
        const db = makeTestDb();
        const i = makeInteraction({ sub: "delete", options: { id: 9999 } });
        await handleCharactersCommand(i as never, db, new Set());
        const r = i.reply.mock.calls[0]![0] as { content: string };
        expect(r.content).toMatch(/No character/);
    });
});

describe("handleCharactersCommand: register", () => {
    it("rejects non-admins", async () => {
        const db = makeTestDb();
        const i = makeInteraction({ sub: "register", userId: "u1" });
        await handleCharactersCommand(i as never, db, new Set(["admin"]));
        const r = i.reply.mock.calls[0]![0] as { content: string };
        expect(r.content).toMatch(/Admin only/);
    });

    it("validates region and class and reports errors", async () => {
        const db = makeTestDb();
        const i = makeInteraction({
            sub: "register",
            userId: "admin",
            targetUser: { id: "u2" },
            options: {
                name: "Bowzo",
                realm: "area-52",
                region: "zz",
                class: "ninja",
                specs: "",
            },
        });
        await handleCharactersCommand(i as never, db, new Set(["admin"]));
        const r = i.reply.mock.calls[0]![0] as { content: string };
        expect(r.content).toMatch(/Invalid input/);
        expect(r.content).toMatch(/region/);
        expect(r.content).toMatch(/class/);
        expect(r.content).toMatch(/spec/);
    });

    it("inserts roster on valid input", async () => {
        const db = makeTestDb();
        const i = makeInteraction({
            sub: "register",
            userId: "admin",
            targetUser: { id: "u2" },
            options: {
                name: "Bowzo",
                realm: "area-52",
                region: "us",
                class: "hunter",
                specs: "beast_mastery,marksmanship",
            },
        });
        await handleCharactersCommand(i as never, db, new Set(["admin"]));
        const r = i.reply.mock.calls[0]![0] as { content: string };
        expect(r.content).toMatch(/Registered/);
    });
});
