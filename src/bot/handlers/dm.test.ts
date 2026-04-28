import { EventEmitter } from "node:events";
import { ChannelType } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { makeTestDb } from "../../test-utils/db.js";
import { registerDmHandler } from "./dm.js";
import { flushMicrotasks as flush, VALID_SIMC } from "../../test-utils/factories.js";

function makeMsg(opts: {
    content: string;
    channelType?: ChannelType;
    bot?: boolean;
    attachments?: unknown[];
    onReply?: (content: string) => void;
}) {
    return {
        content: opts.content,
        channel: { type: opts.channelType ?? ChannelType.DM },
        author: {
            id: "u1",
            bot: opts.bot ?? false,
            createDM: vi.fn(async () => ({})),
        },
        attachments: { values: () => (opts.attachments ?? []).values() },
        reply: vi.fn(async ({ content }: { content: string }) => {
            opts.onReply?.(content);
        }),
    };
}

describe("registerDmHandler", () => {
    it("ignores bot authors and non-DM channels", async () => {
        const db = makeTestDb();
        const client = new EventEmitter() as never;
        const trigger = vi.fn();
        registerDmHandler(client, db, trigger, () => {});

        const botMsg = makeMsg({ content: VALID_SIMC, bot: true });
        (client as unknown as EventEmitter).emit("messageCreate", botMsg);

        const guildMsg = makeMsg({ content: VALID_SIMC, channelType: ChannelType.GuildText });
        (client as unknown as EventEmitter).emit("messageCreate", guildMsg);

        await flush();
        expect(botMsg.reply).not.toHaveBeenCalled();
        expect(guildMsg.reply).not.toHaveBeenCalled();
        expect(trigger).not.toHaveBeenCalled();
    });

    it("does not reply when message is empty with no attachments", async () => {
        const db = makeTestDb();
        const client = new EventEmitter() as never;
        registerDmHandler(client, db, () => {}, () => {});
        const msg = makeMsg({ content: "" });
        (client as unknown as EventEmitter).emit("messageCreate", msg);
        await flush();
        expect(msg.reply).not.toHaveBeenCalled();
    });

    it("stores a valid simc, enqueues a sim, and pokes the worker", async () => {
        const db = makeTestDb();
        const client = new EventEmitter() as never;
        const trigger = vi.fn();
        const poke = vi.fn();
        registerDmHandler(client, db, trigger, poke);
        let reply = "";
        const msg = makeMsg({ content: VALID_SIMC, onReply: (c) => (reply = c) });
        (client as unknown as EventEmitter).emit("messageCreate", msg);
        await flush();
        expect(reply).toMatch(/Stored/);
        expect(reply).toMatch(/Sim queued/);
        expect(trigger).toHaveBeenCalled();
        expect(poke).toHaveBeenCalled();
    });

    it("does not poke the worker when the simc is a duplicate of the last job", async () => {
        const db = makeTestDb();
        const client = new EventEmitter() as never;
        const poke = vi.fn();
        registerDmHandler(client, db, () => {}, poke);
        // First paste — enqueues.
        (client as unknown as EventEmitter).emit("messageCreate", makeMsg({ content: VALID_SIMC }));
        await flush();
        expect(poke).toHaveBeenCalledTimes(1);

        // Second paste of the same simc — should skip enqueue.
        let reply = "";
        const msg2 = makeMsg({ content: VALID_SIMC, onReply: (c) => (reply = c) });
        (client as unknown as EventEmitter).emit("messageCreate", msg2);
        await flush();
        expect(poke).toHaveBeenCalledTimes(1);
        expect(reply).toMatch(/Already simmed/);
    });

    it("pokes the worker even for healer specs (qelive executor handles them)", async () => {
        const db = makeTestDb();
        const client = new EventEmitter() as never;
        const poke = vi.fn();
        registerDmHandler(client, db, () => {}, poke);
        const healerSimc = `# header
priest="Healz"
level=80
race=human
region=us
server=area-52
spec=discipline
`;
        let reply = "";
        const msg = makeMsg({ content: healerSimc, onReply: (c) => (reply = c) });
        (client as unknown as EventEmitter).emit("messageCreate", msg);
        await flush();
        expect(reply).toMatch(/Sim queued/);
        expect(poke).toHaveBeenCalled();
    });

    it("replies with parse-error for malformed simc", async () => {
        const db = makeTestDb();
        const client = new EventEmitter() as never;
        registerDmHandler(client, db, () => {}, () => {});
        let reply = "";
        const broken =
            `hunter="Bowzo"\nregion=us\nspec=beast_mastery\n` + "x".repeat(40);
        const msg = makeMsg({ content: broken, onReply: (c) => (reply = c) });
        (client as unknown as EventEmitter).emit("messageCreate", msg);
        await flush();
        expect(reply).toMatch(/Couldn't parse/);
    });

    it("replies with missing-spec when spec line is absent", async () => {
        const db = makeTestDb();
        const client = new EventEmitter() as never;
        registerDmHandler(client, db, () => {}, () => {});
        let reply = "";
        const noSpec = `hunter="Bowzo"\nlevel=80\nregion=us\nserver=area-52\n`;
        const msg = makeMsg({ content: noSpec, onReply: (c) => (reply = c) });
        (client as unknown as EventEmitter).emit("messageCreate", msg);
        await flush();
        expect(reply).toMatch(/no `spec=` line/);
    });

    it("replies with store-error when DB fails", async () => {
        const db = makeTestDb();
        const repo = await import("../../db/repo.js");
        const spy = vi.spyOn(repo, "upsertCharacter").mockImplementation(() => {
            throw new Error("db dead");
        });
        try {
            const client = new EventEmitter() as never;
            registerDmHandler(client, db, () => {}, () => {});
            let reply = "";
            const msg = makeMsg({ content: VALID_SIMC, onReply: (c) => (reply = c) });
            (client as unknown as EventEmitter).emit("messageCreate", msg);
            await flush();
            expect(reply).toMatch(/Something broke/);
        } finally {
            spy.mockRestore();
        }
    });

    it("logs and swallows when handler throws (e.g. createDM throws)", async () => {
        const db = makeTestDb();
        const client = new EventEmitter() as never;
        registerDmHandler(client, db, () => {}, () => {});
        const msg = {
            content: VALID_SIMC,
            channel: { type: ChannelType.DM },
            author: {
                id: "u1",
                bot: false,
                createDM: vi.fn(() => {
                    throw new Error("createDM threw synchronously");
                }),
            },
            attachments: { values: () => [].values() },
            reply: vi.fn(async () => {
                throw new Error("reply failed");
            }),
        };
        (client as unknown as EventEmitter).emit("messageCreate", msg);
        await flush();
        // No throw escapes the handler — that's the assertion.
    });

    it("replies with not-simc for content that doesn't look like simc", async () => {
        const db = makeTestDb();
        const client = new EventEmitter() as never;
        registerDmHandler(client, db, () => {}, () => {});
        let reply = "";
        const msg = makeMsg({
            content: "# just a header\nrandom prose that's plenty long enough to pass the length check easily here",
            onReply: (c) => (reply = c),
        });
        (client as unknown as EventEmitter).emit("messageCreate", msg);
        await flush();
        expect(reply).toMatch(/SimulationCraft/);
    });
});
