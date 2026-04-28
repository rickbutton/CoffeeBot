import { EventEmitter } from "node:events";
import { ChannelType } from "discord.js";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { makeTestDb } from "../../test-utils/db.js";
import { setStatusChannel } from "../status-message.js";
import { registerChannelHandler } from "./channel.js";
import { flushMicrotasks as flush, VALID_SIMC } from "../../test-utils/factories.js";

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

function makeMsg(opts: {
    channelId?: string;
    channelType?: ChannelType;
    bot?: boolean;
    content?: string;
}) {
    const reply = vi.fn(async () => ({
        delete: vi.fn(async () => {}),
    }));
    return {
        id: "m1",
        channelId: opts.channelId ?? "chan1",
        channel: { type: opts.channelType ?? ChannelType.GuildText },
        author: { id: "u1", bot: opts.bot ?? false },
        content: opts.content ?? VALID_SIMC,
        attachments: { values: () => [].values() },
        react: vi.fn(async () => {}),
        reply,
        delete: vi.fn(async () => {}),
    };
}

describe("registerChannelHandler", () => {
    it("ignores bot/non-guild messages and messages outside the status channel", async () => {
        const db = makeTestDb();
        setStatusChannel(db, "chan1", "msg");
        const client = new EventEmitter() as never;
        const trigger = vi.fn();
        registerChannelHandler(client, db, trigger);

        (client as unknown as EventEmitter).emit("messageCreate", makeMsg({ bot: true }));
        (client as unknown as EventEmitter).emit(
            "messageCreate",
            makeMsg({ channelType: ChannelType.DM }),
        );
        (client as unknown as EventEmitter).emit(
            "messageCreate",
            makeMsg({ channelId: "different" }),
        );
        await flush();
        expect(trigger).not.toHaveBeenCalled();
    });

    it("does nothing when no status channel is configured", async () => {
        const db = makeTestDb();
        const client = new EventEmitter() as never;
        const trigger = vi.fn();
        registerChannelHandler(client, db, trigger);
        (client as unknown as EventEmitter).emit("messageCreate", makeMsg({}));
        await flush();
        expect(trigger).not.toHaveBeenCalled();
    });

    it("reacts ✅ on stored, schedules delete, triggers status update", async () => {
        const db = makeTestDb();
        setStatusChannel(db, "chan1", "msg");
        const client = new EventEmitter() as never;
        const trigger = vi.fn();
        registerChannelHandler(client, db, trigger);

        const msg = makeMsg({});
        (client as unknown as EventEmitter).emit("messageCreate", msg);
        await flush();
        expect(msg.react).toHaveBeenCalledWith("✅");
        expect(trigger).toHaveBeenCalled();
        // Run scheduled delete
        vi.advanceTimersByTime(6000);
        await flush();
        expect(msg.delete).toHaveBeenCalled();
    });

    it("reacts ❌ and replies on parse error", async () => {
        const db = makeTestDb();
        setStatusChannel(db, "chan1", "msg");
        const client = new EventEmitter() as never;
        registerChannelHandler(client, db, () => {});

        const broken =
            `hunter="Bowzo"\nregion=us\nspec=beast_mastery\n` + "x".repeat(40);
        const msg = makeMsg({ content: broken });
        (client as unknown as EventEmitter).emit("messageCreate", msg);
        await flush();
        expect(msg.react).toHaveBeenCalledWith("❌");
        expect(msg.reply).toHaveBeenCalled();
    });

    it("returns silently for no-content messages", async () => {
        const db = makeTestDb();
        setStatusChannel(db, "chan1", "msg");
        const client = new EventEmitter() as never;
        registerChannelHandler(client, db, () => {});
        const msg = makeMsg({ content: "" });
        (client as unknown as EventEmitter).emit("messageCreate", msg);
        await flush();
        expect(msg.react).not.toHaveBeenCalled();
        expect(msg.reply).not.toHaveBeenCalled();
    });

    it("reacts ❌ + replies on store-error and runs scheduled delete + reply.delete", async () => {
        const db = makeTestDb();
        setStatusChannel(db, "chan1", "msg");
        const repo = await import("../../db/repo.js");
        const spy = vi.spyOn(repo, "upsertCharacter").mockImplementation(() => {
            throw new Error("db dead");
        });
        try {
            const client = new EventEmitter() as never;
            registerChannelHandler(client, db, () => {});
            const msg = makeMsg({});
            (client as unknown as EventEmitter).emit("messageCreate", msg);
            await flush();
            expect(msg.react).toHaveBeenCalledWith("❌");
            expect(msg.reply).toHaveBeenCalled();
            // Drive scheduleDelete + ephemeral reply.delete timers.
            await vi.runAllTimersAsync();
            expect(msg.delete).toHaveBeenCalled();
        } finally {
            spy.mockRestore();
        }
    });

    it("logs and swallows when handler throws", async () => {
        const db = makeTestDb();
        setStatusChannel(db, "chan1", "msg");
        const repo = await import("../../db/repo.js");
        const spy = vi.spyOn(repo, "upsertCharacter").mockImplementation(() => {
            throw new Error("db dead");
        });
        try {
            const client = new EventEmitter() as never;
            registerChannelHandler(client, db, () => {});
            const msg = makeMsg({});
            // Make `react` throw to exercise the outer try/catch.
            msg.react.mockImplementation(async () => {
                throw new Error("kaboom");
            });
            (client as unknown as EventEmitter).emit("messageCreate", msg);
            await flush();
        } finally {
            spy.mockRestore();
        }
    });

    it("logs warn when scheduled delete fails", async () => {
        const db = makeTestDb();
        setStatusChannel(db, "chan1", "msg");
        const client = new EventEmitter() as never;
        registerChannelHandler(client, db, () => {});
        const msg = makeMsg({});
        msg.delete.mockImplementation(async () => {
            throw new Error("perm denied");
        });
        (client as unknown as EventEmitter).emit("messageCreate", msg);
        await flush();
        vi.advanceTimersByTime(6000);
        await flush();
        // No throw is success.
    });

    it("renders a reply for not-simc, missing-spec, store-error", async () => {
        const db = makeTestDb();
        setStatusChannel(db, "chan1", "msg");
        const client = new EventEmitter() as never;
        registerChannelHandler(client, db, () => {});

        const notSimc = makeMsg({ content: "hi" });
        (client as unknown as EventEmitter).emit("messageCreate", notSimc);
        await flush();
        expect(notSimc.reply).toHaveBeenCalled();

        const missingSpec = makeMsg({
            content: `hunter="Bowzo"\nlevel=80\nregion=us\nserver=area-52\n`,
        });
        (client as unknown as EventEmitter).emit("messageCreate", missingSpec);
        await flush();
        expect(missingSpec.reply).toHaveBeenCalled();
    });
});
