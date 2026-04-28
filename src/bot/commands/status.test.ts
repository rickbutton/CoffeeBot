import { ChannelType, PermissionFlagsBits } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { makeTestDb } from "../../test-utils/db.js";
import { getStatusChannelId, setStatusChannel } from "../status-message.js";
import { handleStatusCommand } from "./status.js";

const ALL_PERMS_BIT = Object.values(PermissionFlagsBits).reduce(
    (a, b) => a | (b as bigint),
    0n,
);

function makeChannel(opts: {
    id?: string;
    type?: ChannelType;
    perms?: bigint;
    sendThrows?: boolean;
}) {
    const send = vi.fn(async () => ({ id: "msg1", url: "https://discord/x" }));
    if (opts.sendThrows)
        send.mockImplementation(async () => {
            throw new Error("nope");
        });
    const me = { id: "bot" };
    return {
        id: opts.id ?? "chan1",
        type: opts.type ?? ChannelType.GuildText,
        send,
        guild: {
            members: { me },
        },
        permissionsFor: vi.fn(() => ({
            has: (flag: bigint) => ((opts.perms ?? ALL_PERMS_BIT) & flag) === flag,
        })),
    };
}

function makeInteraction(opts: {
    sub: string;
    userId?: string;
    channel?: ReturnType<typeof makeChannel>;
}) {
    const reply = vi.fn<(opts: unknown) => Promise<undefined>>(async () => undefined);
    const deferReply = vi.fn<(opts?: unknown) => Promise<undefined>>(async () => undefined);
    const editReply = vi.fn<(opts: unknown) => Promise<undefined>>(async () => undefined);
    return {
        user: { id: opts.userId ?? "admin" },
        options: {
            getSubcommand: () => opts.sub,
            getChannel: () => opts.channel,
        },
        reply,
        deferReply,
        editReply,
    };
}

describe("handleStatusCommand: auth + setup", () => {
    it("rejects non-admins", async () => {
        const db = makeTestDb();
        const i = makeInteraction({ sub: "setup", userId: "x" });
        await handleStatusCommand(i as never, db, new Set(["admin"]), 7);
        const r = i.reply.mock.calls[0]![0] as { content: string };
        expect(r.content).toMatch(/Admin only/);
    });

    it("rejects non-text channels", async () => {
        const db = makeTestDb();
        const ch = makeChannel({ type: ChannelType.GuildVoice });
        const i = makeInteraction({ sub: "setup", channel: ch });
        await handleStatusCommand(i as never, db, new Set(["admin"]), 7);
        const r = i.reply.mock.calls[0]![0] as { content: string };
        expect(r.content).toMatch(/regular text channel/);
    });

    it("reports missing permissions", async () => {
        const db = makeTestDb();
        const ch = makeChannel({ perms: 0n });
        const i = makeInteraction({ sub: "setup", channel: ch });
        await handleStatusCommand(i as never, db, new Set(["admin"]), 7);
        const r = i.reply.mock.calls[0]![0] as { content: string };
        expect(r.content).toMatch(/missing these permissions/);
    });

    it("posts the message and stores channel/message ids", async () => {
        const db = makeTestDb();
        const ch = makeChannel({});
        const i = makeInteraction({ sub: "setup", channel: ch });
        await handleStatusCommand(i as never, db, new Set(["admin"]), 7);
        expect(ch.send).toHaveBeenCalled();
        expect(getStatusChannelId(db)).toBe("chan1");
        expect(i.editReply).toHaveBeenCalled();
    });
});

describe("handleStatusCommand: clear", () => {
    it("clears stored channel id", async () => {
        const db = makeTestDb();
        setStatusChannel(db, "chan1", "msg");
        const i = makeInteraction({ sub: "clear" });
        await handleStatusCommand(i as never, db, new Set(["admin"]), 7);
        expect(getStatusChannelId(db)).toBe(null);
        const r = i.reply.mock.calls[0]![0] as { content: string };
        expect(r.content).toMatch(/Forgot/);
    });
});
