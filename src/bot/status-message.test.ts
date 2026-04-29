import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { ChannelType } from "discord.js";
import { makeTestDb } from "../test-utils/db.js";
import { setBotState, upsertCharacter, addCharacterRoster } from "../db/repo.js";
import { characters, simJobs } from "../db/schema.js";
import {
    clearStatusChannel,
    getStatusChannelId,
    getStatusMessageIds,
    makeStatusUpdater,
    renderStatusPages,
    setStatusChannel,
    setStatusMessageIds,
    updateStatusMessage,
} from "./status-message.js";
import { sampleCharacter as sample } from "../test-utils/factories.js";

describe("status channel state", () => {
    it("set/get/clear round-trips channel + array of message ids", () => {
        const db = makeTestDb();
        expect(getStatusChannelId(db)).toBe(null);
        expect(getStatusMessageIds(db)).toEqual([]);

        setStatusChannel(db, "chan1", ["msg1", "msg2"]);
        expect(getStatusChannelId(db)).toBe("chan1");
        expect(getStatusMessageIds(db)).toEqual(["msg1", "msg2"]);

        setStatusMessageIds(db, ["msg1"]);
        expect(getStatusMessageIds(db)).toEqual(["msg1"]);

        clearStatusChannel(db);
        expect(getStatusChannelId(db)).toBe(null);
        expect(getStatusMessageIds(db)).toEqual([]);
    });

    it("falls back to legacy single-id key when only the legacy key is present", () => {
        const db = makeTestDb();
        // Simulate pre-pagination state by writing only the legacy key directly.
        setBotState(db, "status_message_id", "legacy-msg");
        expect(getStatusMessageIds(db)).toEqual(["legacy-msg"]);
    });

    it("setStatusMessageIds removes the legacy key", () => {
        const db = makeTestDb();
        setBotState(db, "status_message_id", "legacy");
        setStatusMessageIds(db, ["new1", "new2"]);
        // Re-reading should now hit the new key, not return the legacy.
        expect(getStatusMessageIds(db)).toEqual(["new1", "new2"]);
    });

    it("ignores corrupted JSON in the message-ids key and falls back to legacy", () => {
        const db = makeTestDb();
        setBotState(db, "status_message_ids", "not-json");
        setBotState(db, "status_message_id", "legacy");
        expect(getStatusMessageIds(db)).toEqual(["legacy"]);
    });
});

describe("renderStatusPages", () => {
    it("produces a single embed when the roster is empty", () => {
        const db = makeTestDb();
        const pages = renderStatusPages(db, 7);
        expect(pages).toHaveLength(1);
        const embed = pages[0]!.toJSON();
        expect(embed.description).toContain("No characters registered");
        expect(embed.color).toBe(0x33cc66);
        expect(embed.footer?.text).toContain("0 fresh");
        expect(embed.title).toBe("Droptimizer Reports");
    });

    it("renders fresh, stale, missing and per-job sim status", () => {
        const db = makeTestDb();
        const fresh = upsertCharacter(db, "u1", sample({ name: "Fresh" }), "raw");
        const stale = upsertCharacter(db, "u1", sample({ name: "Stale", spec: "marksmanship" }), "raw");
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
        const reqStale = upsertCharacter(db, "u2", sample({ name: "ReqStale" }), "raw");
        db.update(characters)
            .set({
                updatedAt: new Date(Date.now() - 60_000),
                lastRequestedAt: new Date(Date.now() - 1_000),
            })
            .where(eq(characters.id, reqStale.id))
            .run();

        const jobStatuses = ["queued", "running", "cancelled", "failed", "done"] as const;
        for (const s of jobStatuses) {
            db.insert(simJobs)
                .values({
                    characterId: fresh.id,
                    simcSnapshot: "raw",
                    status: s,
                    error: s === "failed" ? "boom".repeat(40) : null,
                    reportUrl: s === "done" ? "https://x/r/abc" : null,
                    completedAt: s === "done" ? new Date(Date.now() - 5_000) : null,
                })
                .run();
        }

        const pages = renderStatusPages(db, 7);
        expect(pages).toHaveLength(1);
        const embed = pages[0]!.toJSON();
        const desc = embed.description!;
        expect(desc).toContain("<@u1>");
        expect(desc).toContain("<@u2>");
        expect(desc).toMatch(/report/);
        expect(desc).toContain("Stale");
        expect(desc).toContain("Pending");
        expect(embed.color).toBe(0xffaa00);
        expect(embed.footer?.text).toMatch(/\d+ fresh/);
    });

    it("marks done report as outdated when simc updated after job completion", () => {
        const db = makeTestDb();
        const c = upsertCharacter(db, "u1", sample(), "raw");
        db.insert(simJobs)
            .values({
                characterId: c.id,
                simcSnapshot: "raw",
                status: "done",
                reportUrl: "https://x/r/abc",
                completedAt: new Date(Date.now() - 60_000),
            })
            .run();
        db.update(characters)
            .set({ updatedAt: new Date() })
            .where(eq(characters.id, c.id))
            .run();
        const desc = renderStatusPages(db, 7)[0]!.toJSON().description!;
        expect(desc).toContain("simc updated since");
    });

    it("handles done job with no report url", () => {
        const db = makeTestDb();
        const c = upsertCharacter(db, "u1", sample(), "raw");
        db.insert(simJobs)
            .values({
                characterId: c.id,
                simcSnapshot: "raw",
                status: "done",
                completedAt: new Date(),
            })
            .run();
        const desc = renderStatusPages(db, 7)[0]!.toJSON().description!;
        expect(desc).toContain("sim: done");
    });

    it("renders each non-done job status as the latest job per character", () => {
        const db = makeTestDb();
        const owners: Array<["queued" | "running" | "cancelled" | "failed", string]> = [
            ["queued", "u1"],
            ["running", "u2"],
            ["cancelled", "u3"],
            ["failed", "u4"],
        ];
        for (const [s, owner] of owners) {
            const c = upsertCharacter(db, owner, sample({ name: `Char${owner}` }), "raw");
            db.insert(simJobs)
                .values({
                    characterId: c.id,
                    simcSnapshot: "raw",
                    status: s,
                    error: s === "failed" ? "boom" : null,
                })
                .run();
        }
        const desc = renderStatusPages(db, 7)[0]!.toJSON().description!;
        expect(desc).toContain("queued");
        expect(desc).toContain("running");
        expect(desc).toContain("cancelled");
        expect(desc).toContain("failed");
        expect(desc).toContain("(boom)");
    });

    it("renders healer specs the same as everyone else now (qelive sims them)", () => {
        const db = makeTestDb();
        const c = upsertCharacter(
            db,
            "u1",
            sample({ name: "Healz", className: "priest", spec: "discipline" }),
            "raw",
        );
        db.insert(simJobs)
            .values({
                characterId: c.id,
                simcSnapshot: "raw",
                status: "done",
                reportUrl: "https://questionablyepic.com/live/upgradereport/abc",
            })
            .run();
        const desc = renderStatusPages(db, 7)[0]!.toJSON().description!;
        expect(desc).not.toContain("healer (use QELive)");
        expect(desc).toContain("https://questionablyepic.com/live/upgradereport/abc");
    });

    it("splits a many-player roster into multiple pages with each ≤4000 chars", () => {
        const db = makeTestDb();
        // 22 owners × 3 specs each = roughly 22 mention headers + 66 character lines.
        for (let owner = 0; owner < 22; owner++) {
            const ownerId = `owner${owner.toString().padStart(2, "0")}`;
            for (const spec of ["fire", "frost", "arcane"]) {
                upsertCharacter(
                    db,
                    ownerId,
                    sample({ name: `Char${owner}_${spec}`, spec, className: "mage" }),
                    "raw",
                );
            }
        }
        const pages = renderStatusPages(db, 7);
        expect(pages.length).toBeGreaterThan(1);
        for (const p of pages) {
            const desc = p.toJSON().description!;
            expect(desc.length).toBeLessThanOrEqual(4000);
        }
        const titles = pages.map((p) => p.toJSON().title);
        expect(titles[0]).toBe(`Droptimizer Reports (1/${pages.length})`);
        expect(titles[titles.length - 1]).toBe(`Droptimizer Reports (${pages.length}/${pages.length})`);

        // First page only has INSTRUCTIONS; only last page has the totals footer.
        expect(pages[0]!.toJSON().description).toContain("How this channel works");
        for (let i = 1; i < pages.length; i++) {
            expect(pages[i]!.toJSON().description).not.toContain("How this channel works");
        }
        for (let i = 0; i < pages.length - 1; i++) {
            expect(pages[i]!.toJSON().footer).toBeUndefined();
        }
        expect(pages[pages.length - 1]!.toJSON().footer?.text).toMatch(/character\/spec/);

        // Owner atomicity: every owner mention appears in exactly one page.
        for (let owner = 0; owner < 22; owner++) {
            const mention = `<@owner${owner.toString().padStart(2, "0")}>`;
            const hits = pages.filter((p) => p.toJSON().description!.includes(mention)).length;
            expect(hits).toBe(1);
        }
    });
});

describe("updateStatusMessage", () => {
    function makeMockClient(channel: unknown) {
        return {
            channels: { fetch: vi.fn(async () => channel) },
        } as never;
    }

    function makeChannel(opts: {
        edit?: ReturnType<typeof vi.fn>;
        fetchThrowsForId?: string;
        sendIds?: string[];
        sendThrowsAt?: number; // 0-based index of which send should reject
    }) {
        const editFn = opts.edit ?? vi.fn(async () => undefined);
        const messages = {
            fetch: vi.fn(async (id: string) => {
                if (opts.fetchThrowsForId && id === opts.fetchThrowsForId) {
                    throw new Error("gone");
                }
                return { id, edit: editFn, delete: vi.fn(async () => {}) };
            }),
        };
        let sendIdx = 0;
        const send = vi.fn(async () => {
            const i = sendIdx++;
            if (opts.sendThrowsAt === i) throw new Error("send failed");
            const id = opts.sendIds?.[i] ?? `posted${i}`;
            return { id };
        });
        return { type: ChannelType.GuildText, messages, send, _editFn: editFn };
    }

    it("does nothing when no channel id is configured", async () => {
        const db = makeTestDb();
        const client = makeMockClient(null);
        await updateStatusMessage(client, db, 7);
        expect((client as unknown as { channels: { fetch: ReturnType<typeof vi.fn> } }).channels.fetch).not.toHaveBeenCalled();
    });

    it("warns and returns if the channel is missing", async () => {
        const db = makeTestDb();
        setStatusChannel(db, "chan", ["msg"]);
        const client = makeMockClient(null);
        await updateStatusMessage(client, db, 7);
    });

    it("warns and returns if channel is not GuildText", async () => {
        const db = makeTestDb();
        setStatusChannel(db, "chan", ["msg"]);
        const client = makeMockClient({ type: ChannelType.DM });
        await updateStatusMessage(client, db, 7);
    });

    it("edits the only message in place when the page count is 1 and the id resolves", async () => {
        const db = makeTestDb();
        setStatusChannel(db, "chan", ["msg"]);
        const channel = makeChannel({});
        await updateStatusMessage(makeMockClient(channel), db, 7);
        expect(channel._editFn).toHaveBeenCalledOnce();
        expect(channel.send).not.toHaveBeenCalled();
        expect(getStatusMessageIds(db)).toEqual(["msg"]);
    });

    it("posts a fresh message when the stored id is gone, and persists the new id", async () => {
        const db = makeTestDb();
        setStatusChannel(db, "chan", ["oldmsg"]);
        const channel = makeChannel({ fetchThrowsForId: "oldmsg", sendIds: ["newmsg"] });
        await updateStatusMessage(makeMockClient(channel), db, 7);
        expect(channel.send).toHaveBeenCalledOnce();
        expect(getStatusMessageIds(db)).toEqual(["newmsg"]);
    });

    it("upgrades from legacy single-id to array key on first run", async () => {
        const db = makeTestDb();
        setBotState(db, "status_channel_id", "chan");
        setBotState(db, "status_message_id", "legacy");
        // Seed enough characters to produce 2 pages so we exercise post-after-edit.
        for (let owner = 0; owner < 22; owner++) {
            const ownerId = `o${owner}`;
            for (const spec of ["fire", "frost", "arcane"]) {
                upsertCharacter(
                    db,
                    ownerId,
                    sample({ name: `C${owner}_${spec}`, spec, className: "mage" }),
                    "raw",
                );
            }
        }
        const channel = makeChannel({ sendIds: ["new1", "new2", "new3"] });
        await updateStatusMessage(makeMockClient(channel), db, 7);
        const ids = getStatusMessageIds(db);
        expect(ids[0]).toBe("legacy");
        expect(ids.length).toBeGreaterThan(1);
        // Legacy key gone after the upgrade.
        expect(setBotState).not.toThrow;
    });

    it("posts additional pages when page count grows from 1 to many", async () => {
        const db = makeTestDb();
        setStatusChannel(db, "chan", ["existing"]);
        for (let owner = 0; owner < 22; owner++) {
            const ownerId = `o${owner}`;
            for (const spec of ["fire", "frost", "arcane"]) {
                upsertCharacter(
                    db,
                    ownerId,
                    sample({ name: `C${owner}_${spec}`, spec, className: "mage" }),
                    "raw",
                );
            }
        }
        const channel = makeChannel({ sendIds: ["p2", "p3", "p4"] });
        await updateStatusMessage(makeMockClient(channel), db, 7);
        const ids = getStatusMessageIds(db);
        expect(ids[0]).toBe("existing");
        expect(ids.length).toBeGreaterThan(1);
        // We should have edited 1 and posted (ids.length - 1).
        expect(channel.send).toHaveBeenCalledTimes(ids.length - 1);
    });

    it("deletes obsolete trailing messages when page count shrinks", async () => {
        const db = makeTestDb();
        setStatusChannel(db, "chan", ["keep", "drop1", "drop2"]);
        // Empty roster → 1 page only.
        const channel = makeChannel({});
        await updateStatusMessage(makeMockClient(channel), db, 7);
        expect(channel._editFn).toHaveBeenCalledOnce(); // only "keep" gets edited
        expect(channel.send).not.toHaveBeenCalled();
        // Both drop1 and drop2 should have been fetched (for deletion).
        const fetches = channel.messages.fetch.mock.calls.map((c) => c[0]);
        expect(fetches).toContain("drop1");
        expect(fetches).toContain("drop2");
        expect(getStatusMessageIds(db)).toEqual(["keep"]);
    });

    it("persists partial progress when a send fails mid-loop", async () => {
        const db = makeTestDb();
        setStatusChannel(db, "chan", []); // start with no pages stored
        for (let owner = 0; owner < 22; owner++) {
            const ownerId = `o${owner}`;
            for (const spec of ["fire", "frost", "arcane"]) {
                upsertCharacter(
                    db,
                    ownerId,
                    sample({ name: `C${owner}_${spec}`, spec, className: "mage" }),
                    "raw",
                );
            }
        }
        // Reject the second send so we land with 1 stored id.
        const channel = makeChannel({ sendIds: ["p1"], sendThrowsAt: 1 });
        await updateStatusMessage(makeMockClient(channel), db, 7);
        const ids = getStatusMessageIds(db);
        expect(ids).toEqual(["p1"]);
    });

    it("logs error when send throws but doesn't rethrow", async () => {
        const db = makeTestDb();
        setStatusChannel(db, "chan", []);
        const channel = {
            type: ChannelType.GuildText,
            messages: { fetch: vi.fn() },
            send: vi.fn(async () => Promise.reject(new Error("nope"))),
        };
        await updateStatusMessage(makeMockClient(channel), db, 7);
    });
});

describe("makeStatusUpdater", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("logs error when the underlying update rejects", async () => {
        const db = makeTestDb();
        setStatusChannel(db, "chan", ["msg"]);
        const client = {
            channels: {
                fetch: vi.fn(() => {
                    throw new Error("sync throw");
                }),
            },
        } as never;
        const updater = makeStatusUpdater(client, db, 7);
        updater();
        await vi.runAllTimersAsync();
    });

    it("debounces calls and triggers updateStatusMessage once", async () => {
        const db = makeTestDb();
        setStatusChannel(db, "chan", ["msg"]);
        const edit = vi.fn(async () => undefined);
        const fetch = vi.fn(async () => ({ id: "msg", edit, delete: vi.fn() }));
        const client = {
            channels: {
                fetch: vi.fn(async () => ({
                    type: ChannelType.GuildText,
                    messages: { fetch },
                    send: vi.fn(),
                })),
            },
        } as never;
        const updater = makeStatusUpdater(client, db, 7);
        updater();
        updater();
        updater();
        await vi.runAllTimersAsync();
        expect(fetch).toHaveBeenCalledOnce();
        expect(edit).toHaveBeenCalledOnce();
    });
});
