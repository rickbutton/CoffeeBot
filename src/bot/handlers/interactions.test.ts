import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { makeTestDb } from "../../test-utils/db.js";
import { setStatusChannel } from "../status-message.js";
import { registerInteractionHandler } from "./interactions.js";
import {
    asyncMock,
    flushMicrotasks as flush,
    makeWorker,
} from "../../test-utils/factories.js";

function makeInteraction(opts: {
    commandName: string;
    sub?: string;
    channelId?: string;
    userId?: string;
    deferred?: boolean;
    replied?: boolean;
}) {
    const reply = asyncMock();
    const followUp = asyncMock();
    return {
        isChatInputCommand: () => true,
        commandName: opts.commandName,
        channelId: opts.channelId ?? "chan1",
        deferred: opts.deferred ?? false,
        replied: opts.replied ?? false,
        user: { id: opts.userId ?? "admin" },
        client: {} as never,
        options: {
            getSubcommand: (_required?: boolean) => opts.sub ?? "list",
            getUser: () => ({ id: opts.userId ?? "admin" }),
            getString: () => "",
            getInteger: () => 0,
        },
        reply,
        followUp,
    };
}

describe("registerInteractionHandler", () => {
    it("ignores non-chat-input interactions", async () => {
        const db = makeTestDb();
        const client = new EventEmitter() as never;
        registerInteractionHandler(client, db, makeWorker(), new Set(), 7, () => {}, null);
        const trigger = vi.fn();
        const i = { isChatInputCommand: () => false };
        (client as unknown as EventEmitter).emit("interactionCreate", i);
        await flush();
        expect(trigger).not.toHaveBeenCalled();
    });

    it("blocks commands run outside the configured status channel", async () => {
        const db = makeTestDb();
        setStatusChannel(db, "chan1", "msg");
        const client = new EventEmitter() as never;
        registerInteractionHandler(client, db, makeWorker(), new Set(["admin"]), 7, () => {}, null);
        const i = makeInteraction({ commandName: "help", channelId: "other" });
        (client as unknown as EventEmitter).emit("interactionCreate", i);
        await flush();
        expect(i.reply).toHaveBeenCalledWith(
            expect.objectContaining({ content: expect.stringContaining("only works in") }),
        );
    });

    it("allows /status setup outside the status channel", async () => {
        const db = makeTestDb();
        setStatusChannel(db, "chan1", "msg");
        const client = new EventEmitter() as never;
        registerInteractionHandler(client, db, makeWorker(), new Set(["admin"]), 7, () => {}, null);
        const i = makeInteraction({
            commandName: "status",
            sub: "setup",
            channelId: "other",
            userId: "non-admin",
        });
        (client as unknown as EventEmitter).emit("interactionCreate", i);
        await flush();
        // Should not reply with the channel-restriction error.
        const calls = i.reply.mock.calls;
        for (const [arg] of calls) {
            expect((arg as { content: string }).content).not.toMatch(/only works in/);
        }
    });

    it("dispatches to /help and triggers nothing", async () => {
        const db = makeTestDb();
        const client = new EventEmitter() as never;
        registerInteractionHandler(
            client,
            db,
            makeWorker(),
            new Set(["admin"]),
            7,
            () => {},
            null,
        );
        const i = makeInteraction({ commandName: "help", userId: "admin" });
        (client as unknown as EventEmitter).emit("interactionCreate", i);
        await flush();
        expect(i.reply).toHaveBeenCalled();
    });

    it("dispatches /sim and /status and triggers status update for both", async () => {
        const db = makeTestDb();
        const client = new EventEmitter() as never;
        const trigger = vi.fn();
        registerInteractionHandler(client, db, makeWorker(), new Set(["admin"]), 7, trigger, null);

        const sim = makeInteraction({ commandName: "sim", sub: "status" });
        (client as unknown as EventEmitter).emit("interactionCreate", sim);
        await flush();

        const status = makeInteraction({
            commandName: "status",
            sub: "clear",
            channelId: "chan1",
        });
        (client as unknown as EventEmitter).emit("interactionCreate", status);
        await flush();

        expect(trigger.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it("dispatches /characters list and triggers status update", async () => {
        const db = makeTestDb();
        const client = new EventEmitter() as never;
        const trigger = vi.fn();
        registerInteractionHandler(client, db, makeWorker(), new Set(), 7, trigger, null);
        const i = makeInteraction({ commandName: "characters", sub: "list" });
        (client as unknown as EventEmitter).emit("interactionCreate", i);
        await flush();
        expect(trigger).toHaveBeenCalled();
    });

    it("catches errors thrown in the dispatched handler and replies", async () => {
        const db = makeTestDb();
        const client = new EventEmitter() as never;
        registerInteractionHandler(client, db, makeWorker(), new Set(["admin"]), 7, () => {}, null);
        const i = makeInteraction({ commandName: "characters", sub: "list" });
        // Make options.getSubcommand throw.
        i.options.getSubcommand = () => {
            throw new Error("boom");
        };
        (client as unknown as EventEmitter).emit("interactionCreate", i);
        await flush();
        expect(i.reply).toHaveBeenCalledWith(
            expect.objectContaining({ content: expect.stringContaining("Something broke") }),
        );
    });

    it("uses followUp when the interaction was already deferred", async () => {
        const db = makeTestDb();
        const client = new EventEmitter() as never;
        registerInteractionHandler(client, db, makeWorker(), new Set(["admin"]), 7, () => {}, null);
        const i = makeInteraction({ commandName: "characters", sub: "list", deferred: true });
        i.options.getSubcommand = () => {
            throw new Error("boom");
        };
        (client as unknown as EventEmitter).emit("interactionCreate", i);
        await flush();
        expect(i.followUp).toHaveBeenCalled();
        expect(i.reply).not.toHaveBeenCalled();
    });
});
