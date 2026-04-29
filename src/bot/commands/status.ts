import {
    ChannelType,
    type ChatInputCommandInteraction,
    InteractionContextType,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder,
    type TextChannel,
} from "discord.js";
import type { Db } from "../../db/client.js";
import { clearStatusChannel, renderStatusPages, setStatusChannel } from "../status-message.js";

const EPHEMERAL = MessageFlags.Ephemeral;

const REQUIRED_PERMS = [
    { flag: PermissionFlagsBits.ViewChannel, name: "View Channel" },
    { flag: PermissionFlagsBits.SendMessages, name: "Send Messages" },
    { flag: PermissionFlagsBits.EmbedLinks, name: "Embed Links" },
    { flag: PermissionFlagsBits.AddReactions, name: "Add Reactions" },
    { flag: PermissionFlagsBits.ReadMessageHistory, name: "Read Message History" },
    { flag: PermissionFlagsBits.ManageMessages, name: "Manage Messages (to delete user pastes)" },
];

export const statusCommand = new SlashCommandBuilder()
    .setName("status")
    .setDescription("Manage the droptimizer status channel.")
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels.toString())
    .addSubcommand((s) =>
        s
            .setName("setup")
            .setDescription("Designate a text channel as the droptimizer status channel.")
            .addChannelOption((o) =>
                o
                    .setName("channel")
                    .setDescription("The text channel the bot will manage")
                    .addChannelTypes(ChannelType.GuildText)
                    .setRequired(true),
            ),
    )
    .addSubcommand((s) =>
        s
            .setName("clear")
            .setDescription("Forget the configured status channel (does not delete the message)."),
    )
    .toJSON();

export async function handleStatusCommand(
    interaction: ChatInputCommandInteraction,
    db: Db,
    adminUserIds: Set<string>,
    staleDays: number,
): Promise<void> {
    if (!adminUserIds.has(interaction.user.id)) {
        await interaction.reply({ content: ":no_entry: Admin only.", flags: EPHEMERAL });
        return;
    }
    const sub = interaction.options.getSubcommand(true);

    if (sub === "setup") {
        const channel = interaction.options.getChannel("channel", true);
        if (channel.type !== ChannelType.GuildText) {
            await interaction.reply({
                content: ":x: Channel must be a regular text channel.",
                flags: EPHEMERAL,
            });
            return;
        }
        const tc = channel as TextChannel;
        const perms = tc.guild.members.me ? tc.permissionsFor(tc.guild.members.me) : null;
        const missing = REQUIRED_PERMS.filter((r) => !perms?.has(r.flag)).map((r) => r.name);
        if (missing.length > 0) {
            await interaction.reply({
                content:
                    `:x: I'm missing these permissions in <#${tc.id}>:\n` +
                    missing.map((m) => `  • ${m}`).join("\n") +
                    `\nGrant them and re-run \`/status setup\`.`,
                flags: EPHEMERAL,
            });
            return;
        }

        await interaction.deferReply({ flags: EPHEMERAL });
        const embeds = renderStatusPages(db, staleDays);
        const ids: string[] = [];
        let firstUrl = "";
        for (const e of embeds) {
            const m = await tc.send({ embeds: [e] });
            ids.push(m.id);
            if (!firstUrl) firstUrl = m.url;
        }
        setStatusChannel(db, tc.id, ids);
        await interaction.editReply({
            content:
                `:white_check_mark: <#${tc.id}> is now the droptimizer status channel. ` +
                `I'll keep [this message](${firstUrl}) in sync as the roster changes, ` +
                `and players can paste their simcs here.`,
            allowedMentions: { parse: [] },
        });
        return;
    }

    if (sub === "clear") {
        clearStatusChannel(db);
        await interaction.reply({
            content:
                ":wastebasket: Forgot the configured status channel. The existing message in Discord wasn't deleted; remove it manually if you want.",
            flags: EPHEMERAL,
        });
    }
}
