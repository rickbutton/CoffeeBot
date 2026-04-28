import { ChannelType, type Client, type Message } from "discord.js";
import type { Db } from "../../db/client.js";
import { log } from "../../util/log.js";
import { enqueueSuffix, processSimcMessage } from "./simc-paste.js";

const HELP =
    "Hi! Paste a full SimulationCraft string (from the in-game `/simc` addon) and I'll store it. " +
    "Long pastes will arrive as a `.txt` attachment — that's fine, I'll read it.";

export function registerDmHandler(
    client: Client,
    db: Db,
    triggerStatusUpdate: () => void,
    pokeWorker: () => void,
): void {
    client.on("messageCreate", async (msg: Message) => {
        if (msg.author.bot || msg.channel.type !== ChannelType.DM) return;
        try {
            const outcome = await processSimcMessage(db, msg);

            // Re-warm the DM channel cache for this user so future bot restarts
            // don't lose our delivery path.
            msg.author.createDM().catch(() => {});

            switch (outcome.kind) {
                case "no-content":
                    if (msg.content.trim().length > 0) await reply(msg, HELP);
                    return;
                case "not-simc":
                    await reply(
                        msg,
                        ':x: That doesn\'t look like a SimulationCraft export. The first non-comment line should be the class declaration (e.g. `demonhunter="Charname"`).',
                    );
                    return;
                case "parse-error":
                    await reply(msg, `:x: Couldn't parse that simc string: ${outcome.error}`);
                    return;
                case "missing-spec":
                    await reply(
                        msg,
                        ":x: Couldn't tell which spec this is for — the simc string has no `spec=` line. Make sure your character has a spec selected before running `/simc` in WoW.",
                    );
                    return;
                case "store-error":
                    await reply(
                        msg,
                        ":warning: Something broke on my end while saving that. Try again in a moment.",
                    );
                    return;
                case "stored": {
                    const c = outcome.character;
                    if (outcome.enqueue.enqueued > 0) pokeWorker();
                    await reply(
                        msg,
                        `:white_check_mark: ${outcome.created ? "Stored" : "Updated"} **${c.name}** (${c.classDisplay} — ${c.spec}) on **${c.realm}-${c.region.toUpperCase()}**.${enqueueSuffix(outcome.enqueue)}`,
                    );
                    triggerStatusUpdate();
                    return;
                }
            }
        } catch (err) {
            log.error({ err, discordId: msg.author.id }, "DM handler threw");
        }
    });
}

async function reply(msg: Message, content: string): Promise<void> {
    await msg.reply({ content, allowedMentions: { parse: [] } }).catch((err) => {
        log.warn({ err }, "failed to reply to DM");
    });
}
