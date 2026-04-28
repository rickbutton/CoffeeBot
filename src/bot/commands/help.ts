import {
    type ChatInputCommandInteraction,
    InteractionContextType,
    MessageFlags,
    SlashCommandBuilder,
} from "discord.js";

export const helpCommand = new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show admin commands (only you can see the response).")
    .setContexts(InteractionContextType.Guild)
    .toJSON();

export async function handleHelpCommand(
    interaction: ChatInputCommandInteraction,
    adminUserIds: Set<string>,
): Promise<void> {
    if (!adminUserIds.has(interaction.user.id)) {
        await interaction.reply({
            content: ":no_entry: Admin only.",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }
    await interaction.reply({
        content: HELP_BODY,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
    });
}

const HELP_BODY = [
    "**Admin commands** (must be run in the status channel)",
    "",
    "__Roster__",
    "• `/characters register user:@x name:... realm:... region:... class:... specs:...` — pre-register a character with one row per spec",
    "• `/characters list [user:@x]` — list characters",
    "• `/characters delete id:<n>` — remove a character row",
    "",
    "__Sim queue__",
    "• `/sim run-all` — enqueue every stored character with a simc",
    "• `/sim run user:@x` — enqueue one user's characters",
    "• `/sim status` — queue depth, today's count vs cap, recent jobs",
    "• `/sim pause` / `/sim resume` — halt or restart the worker",
    "• `/sim cancel id:<n>` — cancel a queued job",
    "• `/sim request-simcs [mode:all|stale]` — DM each player asking for a refresh",
    "",
    "__Status channel__",
    "• `/status setup channel:#x` — designate the status channel and post the roster message",
    "• `/status clear` — forget the configured channel",
    "",
    "__Help__",
    "• `/help` — this message",
].join("\n");
