import { describe, expect, it } from "vitest";
import { makeTestDb } from "../../test-utils/db.js";
import { addCharacterRoster, upsertCharacter } from "../../db/repo.js";
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

describe("handleCharactersCommand: simc", () => {
    it("rejects non-admins", async () => {
        const db = makeTestDb();
        const i = makeInteraction({ sub: "simc", userId: "u1", options: { id: 1 } });
        await handleCharactersCommand(i as never, db, new Set(["admin"]));
        const r = i.reply.mock.calls[0]![0] as { content: string };
        expect(r.content).toMatch(/Admin only/);
    });

    it("returns not-found for an unknown id", async () => {
        const db = makeTestDb();
        const i = makeInteraction({ sub: "simc", userId: "admin", options: { id: 9999 } });
        await handleCharactersCommand(i as never, db, new Set(["admin"]));
        const r = i.reply.mock.calls[0]![0] as { content: string };
        expect(r.content).toMatch(/No character/);
    });

    it("warns when the character has no simc submitted yet", async () => {
        const db = makeTestDb();
        addCharacterRoster(db, {
            discordId: "u1",
            name: "Bowzo",
            realm: "area-52",
            region: "us",
            className: "hunter",
            specs: ["beast_mastery"],
        });
        // Find the just-registered row id.
        const list = (await import("../../db/repo.js")).listCharacters(db, "u1");
        const id = list[0]!.id;
        const i = makeInteraction({ sub: "simc", userId: "admin", options: { id } });
        await handleCharactersCommand(i as never, db, new Set(["admin"]));
        const r = i.reply.mock.calls[0]![0] as { content: string };
        expect(r.content).toMatch(/no simc submitted yet/);
    });

    it("attaches the stored simc as a .simc file", async () => {
        const db = makeTestDb();
        const c = upsertCharacter(db, "u1", sample(), "raw-simc-string");
        const i = makeInteraction({ sub: "simc", userId: "admin", options: { id: c.id } });
        await handleCharactersCommand(i as never, db, new Set(["admin"]));
        const reply = i.reply.mock.calls[0]![0] as {
            content: string;
            files: { name: string; attachment: Buffer }[];
        };
        expect(reply.content).toMatch(/Stored simc for/);
        expect(reply.files).toHaveLength(1);
        expect(reply.files[0]!.name).toBe("Bowzo-beast_mastery.simc");
        expect(reply.files[0]!.attachment.toString("utf8")).toBe("raw-simc-string");
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
