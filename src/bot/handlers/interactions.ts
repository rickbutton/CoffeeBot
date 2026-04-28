import { type Client, MessageFlags } from "discord.js";
import type { Db } from "../../db/client.js";
import type { WorkerHandle } from "../../queue/worker.js";
import type { Uploader } from "../../wowaudit/upload.js";
import { handleCharactersCommand } from "../commands/characters.js";
import { handleHelpCommand } from "../commands/help.js";
import { handleSimCommand } from "../commands/sim.js";
import { handleStatusCommand } from "../commands/status.js";
import { getStatusChannelId } from "../status-message.js";
import { log } from "../../util/log.js";

export function registerInteractionHandler(
    client: Client,
    db: Db,
    worker: WorkerHandle,
    adminUserIds: Set<string>,
    staleDays: number,
    triggerStatusUpdate: () => void,
    uploader: Uploader | null,
): void {
    client.on("interactionCreate", async (interaction) => {
        if (!interaction.isChatInputCommand()) return;
        try {
            // /status setup must be runnable BEFORE a status channel exists, so
            // skip the channel-restriction check for it.
            const isStatusSetup =
                interaction.commandName === "status" &&
                interaction.options.getSubcommand(false) === "setup";

            if (!isStatusSetup) {
                const statusChannelId = getStatusChannelId(db);
                if (statusChannelId && interaction.channelId !== statusChannelId) {
                    await interaction.reply({
                        content: `:no_entry: This command only works in <#${statusChannelId}>.`,
                        flags: MessageFlags.Ephemeral,
                        allowedMentions: { parse: [] },
                    });
                    return;
                }
            }

            switch (interaction.commandName) {
                case "characters":
                    await handleCharactersCommand(interaction, db, adminUserIds);
                    triggerStatusUpdate();
                    return;
                case "sim":
                    await handleSimCommand(
                        interaction,
                        db,
                        worker,
                        adminUserIds,
                        staleDays,
                        uploader,
                    );
                    triggerStatusUpdate();
                    return;
                case "status":
                    await handleStatusCommand(interaction, db, adminUserIds, staleDays);
                    triggerStatusUpdate();
                    return;
                case "help":
                    await handleHelpCommand(interaction, adminUserIds);
                    return;
            }
        } catch (err) {
            log.error({ err, commandName: interaction.commandName }, "command handler threw");
            const content = ":warning: Something broke handling that command.";
            if (interaction.deferred || interaction.replied) {
                await interaction
                    .followUp({ content, flags: MessageFlags.Ephemeral })
                    .catch(() => {});
            } else {
                await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
            }
        }
    });
}
