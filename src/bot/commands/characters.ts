import {
    type ChatInputCommandInteraction,
    InteractionContextType,
    MessageFlags,
    SlashCommandBuilder,
} from "discord.js";
import type { Db } from "../../db/client.js";
import { addCharacterRoster, deleteCharacter, listCharacters } from "../../db/repo.js";
import { WOW_CLASSES, WOW_REGIONS } from "../../parser/simc.js";

const EPHEMERAL = MessageFlags.Ephemeral;

export const charactersCommand = new SlashCommandBuilder()
    .setName("characters")
    .setDescription("Manage your stored WoW characters.")
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
        s
            .setName("list")
            .setDescription("List your stored characters (or another user's, if admin).")
            .addUserOption((o) =>
                o
                    .setName("user")
                    .setDescription("Whose characters to list (admin only)")
                    .setRequired(false),
            ),
    )
    .addSubcommand((s) =>
        s
            .setName("delete")
            .setDescription("Delete one of your stored characters by id.")
            .addIntegerOption((o) =>
                o
                    .setName("id")
                    .setDescription("Character id (from /characters list)")
                    .setRequired(true),
            ),
    )
    .addSubcommand((s) =>
        s
            .setName("register")
            .setDescription("Pre-register a character + specs for a player (admin only).")
            .addUserOption((o) =>
                o
                    .setName("user")
                    .setDescription("Player who owns this character")
                    .setRequired(true),
            )
            .addStringOption((o) =>
                o.setName("name").setDescription("Character name").setRequired(true),
            )
            .addStringOption((o) =>
                o
                    .setName("realm")
                    .setDescription(
                        "Realm slug as the simc addon emits (e.g. illidan, twisting_nether)",
                    )
                    .setRequired(true),
            )
            .addStringOption((o) =>
                o.setName("region").setDescription("us / eu / kr / tw / cn").setRequired(true),
            )
            .addStringOption((o) =>
                o
                    .setName("class")
                    .setDescription("WoW class (death_knight, demon_hunter, druid, ...)")
                    .setRequired(true),
            )
            .addStringOption((o) =>
                o
                    .setName("specs")
                    .setDescription("Comma-separated spec slugs (e.g. devourer,vengeance)")
                    .setRequired(true),
            ),
    )
    .toJSON();

export async function handleCharactersCommand(
    interaction: ChatInputCommandInteraction,
    db: Db,
    adminUserIds: Set<string>,
): Promise<void> {
    const sub = interaction.options.getSubcommand(true);

    if (sub === "list") return handleList(interaction, db, adminUserIds);
    if (sub === "delete") return handleDelete(interaction, db);
    if (sub === "register") return handleRegister(interaction, db, adminUserIds);
}

async function handleList(
    interaction: ChatInputCommandInteraction,
    db: Db,
    adminUserIds: Set<string>,
): Promise<void> {
    const target = interaction.options.getUser("user");
    const ownerId = target?.id ?? interaction.user.id;
    if (target && target.id !== interaction.user.id && !adminUserIds.has(interaction.user.id)) {
        await interaction.reply({
            content: ":no_entry: Only admins can list other users' characters.",
            flags: EPHEMERAL,
        });
        return;
    }

    const rows = listCharacters(db, ownerId);
    if (rows.length === 0) {
        await interaction.reply({
            content: target
                ? `No characters stored for <@${ownerId}>.`
                : "You haven't stored any characters yet. DM me your simc string to add one.",
            flags: EPHEMERAL,
            allowedMentions: { parse: [] },
        });
        return;
    }

    const lines = rows.map((c) => {
        const status = c.simc
            ? `_updated ${c.updatedAt.toISOString().slice(0, 10)}_`
            : "_(no simc yet)_";
        return `\`#${c.id}\` **${c.name}** *(${c.spec ?? "?"})* — ${c.className} on ${c.realm}-${c.region.toUpperCase()} · ${status}`;
    });
    await interaction.reply({
        content:
            (target ? `Characters for <@${ownerId}>:\n` : "Your characters:\n") + lines.join("\n"),
        flags: EPHEMERAL,
        allowedMentions: { parse: [] },
    });
}

async function handleDelete(interaction: ChatInputCommandInteraction, db: Db): Promise<void> {
    const id = interaction.options.getInteger("id", true);
    const removed = deleteCharacter(db, interaction.user.id, id);
    await interaction.reply({
        content: removed
            ? `:wastebasket: Deleted character \`#${id}\`.`
            : `:question: No character \`#${id}\` belongs to you.`,
        flags: EPHEMERAL,
    });
}

async function handleRegister(
    interaction: ChatInputCommandInteraction,
    db: Db,
    adminUserIds: Set<string>,
): Promise<void> {
    if (!adminUserIds.has(interaction.user.id)) {
        await interaction.reply({ content: ":no_entry: Admin only.", flags: EPHEMERAL });
        return;
    }
    const target = interaction.options.getUser("user", true);
    const name = interaction.options.getString("name", true).trim();
    const realm = interaction.options.getString("realm", true).trim().toLowerCase();
    const region = interaction.options.getString("region", true).trim().toLowerCase();
    const className = interaction.options.getString("class", true).trim().toLowerCase();
    const specs = interaction.options
        .getString("specs", true)
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);

    const errors: string[] = [];
    if (!name) errors.push("name is empty");
    if (!realm) errors.push("realm is empty");
    if (!(WOW_REGIONS as readonly string[]).includes(region)) {
        errors.push(`region "${region}" not one of ${WOW_REGIONS.join(", ")}`);
    }
    if (!(WOW_CLASSES as readonly string[]).includes(className)) {
        errors.push(`class "${className}" not one of ${WOW_CLASSES.join(", ")}`);
    }
    if (specs.length === 0) errors.push("at least one spec is required");
    if (errors.length > 0) {
        await interaction.reply({
            content: `:x: Invalid input:\n${errors.map((e) => `  • ${e}`).join("\n")}`,
            flags: EPHEMERAL,
        });
        return;
    }

    const result = addCharacterRoster(db, {
        discordId: target.id,
        name,
        realm,
        region,
        className,
        specs,
    });
    await interaction.reply({
        content: `:white_check_mark: Registered **${result.inserted}** new spec(s) for **${name}** on ${realm}-${region.toUpperCase()} (owner <@${target.id}>). ${result.alreadyExisted} already existed.`,
        flags: EPHEMERAL,
        allowedMentions: { parse: [] },
    });
}
