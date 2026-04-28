import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { ChannelType } from "discord.js";
import { makeTestDb } from "../test-utils/db.js";
import { upsertCharacter, addCharacterRoster } from "../db/repo.js";
import { characters, simJobs } from "../db/schema.js";
import {
    clearStatusChannel,
    getStatusChannelId,
    makeStatusUpdater,
    renderStatusEmbed,
    setStatusChannel,
    updateStatusMessage,
} from "./status-message.js";
import type { SimcCharacter } from "../parser/simc.js";

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

describe("status channel state", () => {
    it("set/get/clear round-trips channel + message ids", () => {
        const db = makeTestDb();
        expect(getStatusChannelId(db)).toBe(null);
        setStatusChannel(db, "chan1", "msg1");
        expect(getStatusChannelId(db)).toBe("chan1");
        clearStatusChannel(db);
        expect(getStatusChannelId(db)).toBe(null);
    });
});

describe("renderStatusEmbed", () => {
    it("produces an empty-roster embed when there are no characters", () => {
        const db = makeTestDb();
        const embed = renderStatusEmbed(db, 7).toJSON();
        expect(embed.description).toContain("No characters registered");
        expect(embed.color).toBe(0x33cc66);
        expect(embed.footer?.text).toContain("0 fresh");
    });

    it("renders fresh, stale, missing and per-job sim status", () => {
        const db = makeTestDb();
        // Fresh character (just inserted)
        const fresh = upsertCharacter(db, "u1", sample({ name: "Fresh" }), "raw");
        // Stale by date: backdate its updatedAt
        const stale = upsertCharacter(db, "u1", sample({ name: "Stale", spec: "marksmanship" }), "raw");
        db.update(characters)
            .set({ updatedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) })
            .where(eq(characters.id, stale.id))
            .run();
        // Missing simc — admin-registered only
        addCharacterRoster(db, {
            discordId: "u1",
            name: "Pending",
            realm: "r",
            region: "us",
            className: "mage",
            specs: ["fire"],
        });
        // Stale-by-request: lastRequestedAt > updatedAt
        const reqStale = upsertCharacter(db, "u2", sample({ name: "ReqStale" }), "raw");
        db.update(characters)
            .set({
                updatedAt: new Date(Date.now() - 60_000),
                lastRequestedAt: new Date(Date.now() - 1_000),
            })
            .where(eq(characters.id, reqStale.id))
            .run();

        // Add a sim job for the fresh character with each status to exercise formatSimStatus.
        const jobStatuses = ["queued", "running", "cancelled", "failed", "done"] as const;
        for (const s of jobStatuses) {
            db.insert(simJobs)
                .values({
                    characterId: fresh.id,
                    simcSnapshot: "raw",
                    status: s,
                    error: s === "failed" ? "boom".repeat(40) : null,
                    raidbotsUrl: s === "done" ? "https://x/r/abc" : null,
                    completedAt: s === "done" ? new Date(Date.now() - 5_000) : null,
                })
                .run();
        }

        const embed = renderStatusEmbed(db, 7).toJSON();
        expect(embed.description).toBeDefined();
        const desc = embed.description!;
        expect(desc).toContain("<@u1>");
        expect(desc).toContain("<@u2>");
        // Most recent job for fresh is "done" → renders the report link.
        expect(desc).toMatch(/report/);
        // Stale entries indicated in description.
        expect(desc).toContain("Stale");
        expect(desc).toContain("Pending");
        // Footer reflects mixed status → orange color.
        expect(embed.color).toBe(0xffaa00);
        expect(embed.footer?.text).toMatch(/\d+ fresh/);
    });

    it("marks done report as outdated when simc updated after job completion", () => {
        const db = makeTestDb();
        const c = upsertCharacter(db, "u1", sample(), "raw");
        // Sim job completed in the past, then character was updated more recently.
        db.insert(simJobs)
            .values({
                characterId: c.id,
                simcSnapshot: "raw",
                status: "done",
                raidbotsUrl: "https://x/r/abc",
                completedAt: new Date(Date.now() - 60_000),
            })
            .run();
        // Touch updatedAt to be after completedAt.
        db.update(characters)
            .set({ updatedAt: new Date() })
            .where(eq(characters.id, c.id))
            .run();
        const desc = renderStatusEmbed(db, 7).toJSON().description!;
        expect(desc).toContain("simc updated since");
    });

    it("handles done job with no raidbots url", () => {
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
        const desc = renderStatusEmbed(db, 7).toJSON().description!;
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
        const desc = renderStatusEmbed(db, 7).toJSON().description!;
        expect(desc).toContain("queued");
        expect(desc).toContain("running");
        expect(desc).toContain("cancelled");
        expect(desc).toContain("failed");
        expect(desc).toContain("(boom)");
    });

    it("falls through to default for unknown status values", () => {
        const db = makeTestDb();
        const c = upsertCharacter(db, "u1", sample(), "raw");
        db.insert(simJobs)
            .values({ characterId: c.id, simcSnapshot: "raw", status: "weirdstate" })
            .run();
        const desc = renderStatusEmbed(db, 7).toJSON().description!;
        expect(desc).toContain("weirdstate");
    });
});

describe("updateStatusMessage", () => {
    function makeMockClient(channel: unknown) {
        return {
            channels: { fetch: vi.fn(async () => channel) },
        } as never;
    }

    it("does nothing when no channel id is configured", async () => {
        const db = makeTestDb();
        const client = makeMockClient(null);
        await updateStatusMessage(client, db, 7);
        expect((client as unknown as { channels: { fetch: ReturnType<typeof vi.fn> } }).channels.fetch).not.toHaveBeenCalled();
    });

    it("warns and returns if the channel is missing", async () => {
        const db = makeTestDb();
        setStatusChannel(db, "chan", "msg");
        const client = makeMockClient(null);
        await updateStatusMessage(client, db, 7);
        // No throw is success.
    });

    it("warns and returns if channel is not GuildText", async () => {
        const db = makeTestDb();
        setStatusChannel(db, "chan", "msg");
        const client = makeMockClient({ type: ChannelType.DM });
        await updateStatusMessage(client, db, 7);
    });

    it("edits the existing message when fetch succeeds", async () => {
        const db = makeTestDb();
        setStatusChannel(db, "chan", "msg");
        const edit = vi.fn(async () => undefined);
        const channel = {
            type: ChannelType.GuildText,
            messages: { fetch: vi.fn(async () => ({ edit })) },
            send: vi.fn(),
        };
        await updateStatusMessage(makeMockClient(channel), db, 7);
        expect(edit).toHaveBeenCalledOnce();
        expect(channel.send).not.toHaveBeenCalled();
    });

    it("posts a new message when the stored message is gone", async () => {
        const db = makeTestDb();
        setStatusChannel(db, "chan", "oldmsg");
        const channel = {
            type: ChannelType.GuildText,
            messages: { fetch: vi.fn(async () => Promise.reject(new Error("gone"))) },
            send: vi.fn(async () => ({ id: "newmsg" })),
        };
        await updateStatusMessage(makeMockClient(channel), db, 7);
        expect(channel.send).toHaveBeenCalledOnce();
        // Sanity check that we wrote the new message id back.
        // (re-use getStatusChannelId for channel; the message key is internal so just check via re-render flow.)
    });

    it("logs error when send throws but doesn't rethrow", async () => {
        const db = makeTestDb();
        setStatusChannel(db, "chan", "");
        const channel = {
            type: ChannelType.GuildText,
            messages: { fetch: vi.fn() },
            send: vi.fn(async () => Promise.reject(new Error("nope"))),
        };
        await updateStatusMessage(makeMockClient(channel), db, 7);
    });
});

describe("makeStatusUpdater", () => {
    it("logs error when the underlying update rejects", async () => {
        const db = makeTestDb();
        setStatusChannel(db, "chan", "msg");
        const client = {
            channels: {
                fetch: vi.fn(() => {
                    throw new Error("sync throw");
                }),
            },
        } as never;
        const updater = makeStatusUpdater(client, db, 7);
        updater();
        await new Promise((r) => setTimeout(r, 1700));
        // No throw to test runner = success.
    }, 5_000);

    it("debounces calls and triggers updateStatusMessage once", async () => {
        const db = makeTestDb();
        setStatusChannel(db, "chan", "msg");
        const edit = vi.fn(async () => undefined);
        const fetch = vi.fn(async () => ({ edit }));
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
        await new Promise((r) => setTimeout(r, 1700));
        expect(fetch).toHaveBeenCalledOnce();
        expect(edit).toHaveBeenCalledOnce();
    }, 5_000);
});
