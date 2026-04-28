import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb } from "../test-utils/db.js";
import { addCharacterRoster, upsertCharacter } from "../db/repo.js";
import { characters } from "../db/schema.js";
import { setStatusChannel } from "./status-message.js";
import { requestSimcs } from "./request-simcs.js";
import { sampleCharacter as sample } from "../test-utils/factories.js";

function makeClient(behavior: { sentTo: string[]; failIds?: Set<string> } = { sentTo: [] }) {
    return {
        users: {
            fetch: vi.fn(async (id: string) => {
                if (behavior.failIds?.has(id)) throw new Error("user fetch failed");
                return {
                    createDM: async () => ({
                        send: vi.fn(async () => {
                            behavior.sentTo.push(id);
                        }),
                    }),
                };
            }),
        },
    } as never;
}

describe("requestSimcs", () => {
    it("mode=all DMs every owner and counts characters", async () => {
        const db = makeTestDb();
        upsertCharacter(db, "u1", sample({ name: "A" }), "raw");
        upsertCharacter(db, "u1", sample({ name: "B", spec: "marksmanship" }), "raw");
        upsertCharacter(db, "u2", sample({ name: "C" }), "raw");
        const sentTo: string[] = [];
        const r = await requestSimcs(makeClient({ sentTo }), db, "all", 7);
        expect(r.usersDmed).toBe(2);
        expect(r.charactersCovered).toBe(3);
        expect(sentTo.sort()).toEqual(["u1", "u2"]);
    });

    it("mode=stale only DMs owners with stale or missing characters", async () => {
        const db = makeTestDb();
        addCharacterRoster(db, {
            discordId: "u1",
            name: "Pending",
            realm: "r",
            region: "us",
            className: "mage",
            specs: ["fire"],
        });
        upsertCharacter(db, "u2", sample({ name: "Fresh" }), "raw");
        const sentTo: string[] = [];
        const r = await requestSimcs(makeClient({ sentTo }), db, "stale", 7);
        expect(r.usersDmed).toBe(1);
        expect(sentTo).toEqual(["u1"]);
        expect(r.neverSubmitted).toBe(1);
    });

    it("counts skips when DM fetch fails", async () => {
        const db = makeTestDb();
        upsertCharacter(db, "u1", sample(), "raw");
        const r = await requestSimcs(
            makeClient({ sentTo: [], failIds: new Set(["u1"]) }),
            db,
            "all",
            7,
        );
        expect(r.usersSkipped).toBe(1);
        expect(r.usersDmed).toBe(0);
    });

    it("formats DM body with status-channel hint and stale flags", async () => {
        const db = makeTestDb();
        setStatusChannel(db, "chan123", "msg");
        const stale = upsertCharacter(db, "u1", sample({ name: "Old" }), "raw");
        // Backdate to ensure stale.
        db.update(characters)
            .set({ updatedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) })
            .where(eq(characters.id, stale.id))
            .run();
        addCharacterRoster(db, {
            discordId: "u1",
            name: "Pending",
            realm: "r",
            region: "us",
            className: "mage",
            specs: ["fire"],
        });

        let body = "";
        const client = {
            users: {
                fetch: async () => ({
                    createDM: async () => ({
                        send: async (opts: { content: string }) => {
                            body = opts.content;
                        },
                    }),
                }),
            },
        } as never;
        await requestSimcs(client, db, "all", 7);
        expect(body).toContain("<#chan123>");
        expect(body).toContain("never submitted");
        expect(body).toContain("stale");
    });

    it("formats stale-by-request differently", async () => {
        const db = makeTestDb();
        const c = upsertCharacter(db, "u1", sample(), "raw");
        db.update(characters)
            .set({
                updatedAt: new Date(Date.now() - 60_000),
                lastRequestedAt: new Date(Date.now() - 1_000),
            })
            .where(eq(characters.id, c.id))
            .run();
        let body = "";
        const client = {
            users: {
                fetch: async () => ({
                    createDM: async () => ({
                        send: async (opts: { content: string }) => {
                            body = opts.content;
                        },
                    }),
                }),
            },
        } as never;
        await requestSimcs(client, db, "stale", 7);
        expect(body).toContain("no update since last ping");
    });

    it("falls back to DM-me hint when no status channel is set", async () => {
        const db = makeTestDb();
        upsertCharacter(db, "u1", sample(), "raw");
        let body = "";
        const client = {
            users: {
                fetch: async () => ({
                    createDM: async () => ({
                        send: async (opts: { content: string }) => {
                            body = opts.content;
                        },
                    }),
                }),
            },
        } as never;
        await requestSimcs(client, db, "all", 7);
        expect(body).toContain("paste the output back to me here");
    });
});
