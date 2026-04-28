import { describe, expect, it } from "vitest";
import { makeTestDb } from "../test-utils/db.js";
import { eq } from "drizzle-orm";
import {
    addCharacterRoster,
    deleteBotState,
    deleteCharacter,
    getBotState,
    getCharacterById,
    latestJobsByCharacter,
    listAllCharacters,
    listCharacters,
    listKnownDiscordIds,
    listStaleCharacters,
    markCharactersRequested,
    setBotState,
    upsertCharacter,
} from "./repo.js";
import { sampleCharacter as sampleParsed } from "../test-utils/factories.js";
import { characters, simJobs } from "./schema.js";

describe("upsertCharacter", () => {
    it("inserts and then updates the same row when re-pasted", () => {
        const db = makeTestDb();
        const a = upsertCharacter(db, "user1", sampleParsed(), "raw1");
        expect(a.created).toBe(true);
        const b = upsertCharacter(db, "user1", sampleParsed({ level: 81 }), "raw2");
        expect(b.created).toBe(false);
        expect(b.id).toBe(a.id);
        const rows = listCharacters(db, "user1");
        expect(rows).toHaveLength(1);
        expect(rows[0]!.simc).toBe("raw2");
        expect(rows[0]!.level).toBe(81);
    });

    it("treats different specs as separate rows", () => {
        const db = makeTestDb();
        upsertCharacter(db, "user1", sampleParsed({ spec: "beast_mastery" }), "raw");
        upsertCharacter(db, "user1", sampleParsed({ spec: "marksmanship" }), "raw");
        expect(listCharacters(db, "user1")).toHaveLength(2);
    });

    it("treats null spec as its own slot", () => {
        const db = makeTestDb();
        upsertCharacter(db, "user1", sampleParsed({ spec: null }), "raw");
        upsertCharacter(db, "user1", sampleParsed({ spec: null }), "raw2");
        const rows = listCharacters(db, "user1");
        expect(rows).toHaveLength(1);
        expect(rows[0]!.simc).toBe("raw2");
    });
});

describe("listKnownDiscordIds", () => {
    it("returns distinct ids", () => {
        const db = makeTestDb();
        upsertCharacter(db, "user1", sampleParsed({ name: "A" }), "x");
        upsertCharacter(db, "user1", sampleParsed({ name: "B" }), "x");
        upsertCharacter(db, "user2", sampleParsed({ name: "C" }), "x");
        expect(listKnownDiscordIds(db).sort()).toEqual(["user1", "user2"]);
    });
});

describe("listAllCharacters", () => {
    it("returns characters ordered by owner, name, spec", () => {
        const db = makeTestDb();
        upsertCharacter(db, "u2", sampleParsed({ name: "Zed" }), "x");
        upsertCharacter(db, "u1", sampleParsed({ name: "Anna" }), "x");
        const all = listAllCharacters(db);
        expect(all.map((c) => c.discordId)).toEqual(["u1", "u2"]);
    });
});

describe("deleteCharacter", () => {
    it("deletes only the owner's character", () => {
        const db = makeTestDb();
        const a = upsertCharacter(db, "u1", sampleParsed(), "x");
        expect(deleteCharacter(db, "u2", a.id)).toBe(false);
        expect(deleteCharacter(db, "u1", a.id)).toBe(true);
        expect(listCharacters(db, "u1")).toHaveLength(0);
    });
});

describe("addCharacterRoster", () => {
    it("inserts one row per spec; counts duplicates", () => {
        const db = makeTestDb();
        const r1 = addCharacterRoster(db, {
            discordId: "u1",
            name: "Bowzo",
            realm: "area-52",
            region: "us",
            className: "hunter",
            specs: ["beast_mastery", "marksmanship"],
        });
        expect(r1).toEqual({ inserted: 2, alreadyExisted: 0 });
        const r2 = addCharacterRoster(db, {
            discordId: "u1",
            name: "Bowzo",
            realm: "area-52",
            region: "us",
            className: "hunter",
            specs: ["beast_mastery", "survival"],
        });
        expect(r2).toEqual({ inserted: 1, alreadyExisted: 1 });
        expect(listCharacters(db, "u1")).toHaveLength(3);
    });
});

describe("listStaleCharacters / markCharactersRequested", () => {
    it("returns rows missing simc and rows where lastRequestedAt > updatedAt", () => {
        const db = makeTestDb();
        addCharacterRoster(db, {
            discordId: "u1",
            name: "NoSimc",
            realm: "r",
            region: "us",
            className: "mage",
            specs: ["fire"],
        });
        const fresh = upsertCharacter(db, "u1", sampleParsed({ name: "Fresh" }), "raw");
        upsertCharacter(db, "u1", sampleParsed({ name: "Old" }), "raw");

        const stale = listStaleCharacters(db);
        expect(stale.map((c) => c.name).sort()).toEqual(["NoSimc"]);

        markCharactersRequested(db, []); // no-op branch
        // Backdate updatedAt so we can guarantee lastRequestedAt > updatedAt
        // (timestamps store at second precision; "now" calls collide).
        db.update(characters)
            .set({ updatedAt: new Date(Date.now() - 60_000) })
            .where(eq(characters.id, fresh.id))
            .run();
        markCharactersRequested(db, [fresh.id]);
        const stale2 = listStaleCharacters(db);
        expect(stale2.some((c) => c.id === fresh.id)).toBe(true);
    });
});

describe("getCharacterById", () => {
    it("returns the character when present and null otherwise", () => {
        const db = makeTestDb();
        const c = upsertCharacter(db, "u1", sampleParsed(), "raw");
        const found = getCharacterById(db, c.id);
        expect(found?.name).toBe("Bowzo");
        expect(getCharacterById(db, 9999)).toBe(null);
    });
});

describe("latestJobsByCharacter", () => {
    it("returns the most recent job per character", () => {
        const db = makeTestDb();
        const c = upsertCharacter(db, "u1", sampleParsed(), "raw");
        db.insert(simJobs)
            .values({ characterId: c.id, simcSnapshot: "raw", status: "queued" })
            .run();
        db.insert(simJobs)
            .values({ characterId: c.id, simcSnapshot: "raw", status: "done" })
            .run();
        const map = latestJobsByCharacter(db);
        expect(map.get(c.id)?.status).toBe("done");
    });

    it("returns empty map when there are no jobs", () => {
        const db = makeTestDb();
        expect(latestJobsByCharacter(db).size).toBe(0);
    });
});

describe("botState", () => {
    it("set/get/delete round-trips", () => {
        const db = makeTestDb();
        expect(getBotState(db, "k")).toBe(null);
        setBotState(db, "k", "v1");
        expect(getBotState(db, "k")).toBe("v1");
        setBotState(db, "k", "v2");
        expect(getBotState(db, "k")).toBe("v2");
        deleteBotState(db, "k");
        expect(getBotState(db, "k")).toBe(null);
    });
});
