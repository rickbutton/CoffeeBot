import { ChannelType, type Client, type Message } from "discord.js";
import type { Db } from "../../db/client.js";
import { log } from "../../util/log.js";
import { getStatusChannelId } from "../status-message.js";
import { processSimcMessage } from "./simc-paste.js";

const DELETE_AFTER_MS = 5_000;

export function registerChannelHandler(
    client: Client,
    db: Db,
    triggerStatusUpdate: () => void,
    pokeWorker: () => void,
): void {
    client.on("messageCreate", async (msg: Message) => {
        if (msg.author.bot || msg.channel.type !== ChannelType.GuildText) return;
        const statusChannelId = getStatusChannelId(db);
        if (!statusChannelId || msg.channelId !== statusChannelId) return;

        try {
            const outcome = await processSimcMessage(db, msg);
            if (outcome.kind === "no-content") return;

            if (outcome.kind === "stored") {
                if (outcome.enqueue.enqueued > 0) pokeWorker();
                await react(msg, "✅");
                triggerStatusUpdate();
            } else {
                await react(msg, "❌");
                await ephemeralReply(msg, errorReplyFor(outcome));
            }
            scheduleDelete(msg);
        } catch (err) {
            log.error({ err, channelId: msg.channelId }, "channel handler threw");
        }
    });
}

function errorReplyFor(o: {
    kind: "not-simc" | "parse-error" | "missing-spec" | "store-error";
    error?: string;
}): string {
    switch (o.kind) {
        case "not-simc":
            return ":x: That doesn't look like a SimulationCraft export. The first non-comment line should be the class declaration.";
        case "parse-error":
            return `:x: Couldn't parse that simc string: ${o.error}`;
        case "missing-spec":
            return ":x: Couldn't tell which spec this is for — the simc string has no `spec=` line. Make sure your character has a spec selected before running `/simc`.";
        case "store-error":
            return ":warning: Something broke on my end while saving that. Try again in a moment.";
    }
}

function scheduleDelete(msg: Message): void {
    setTimeout(() => {
        msg.delete().catch((err) => {
            log.warn(
                { err, messageId: msg.id },
                "failed to delete user message (missing Manage Messages?)",
            );
        });
    }, DELETE_AFTER_MS);
}

async function react(msg: Message, emoji: string): Promise<void> {
    await msg.react(emoji).catch((err) => log.warn({ err, emoji }, "failed to react"));
}

async function ephemeralReply(msg: Message, content: string): Promise<void> {
    const reply = await msg.reply({ content, allowedMentions: { parse: [] } }).catch((err) => {
        log.warn({ err }, "failed to send reply in channel");
        return null;
    });
    if (reply) setTimeout(() => reply.delete().catch(() => {}), DELETE_AFTER_MS);
}
