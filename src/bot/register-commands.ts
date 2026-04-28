import { REST, Routes } from "discord.js";
import { log } from "../util/log.js";
import { charactersCommand } from "./commands/characters.js";
import { helpCommand } from "./commands/help.js";
import { simCommand } from "./commands/sim.js";
import { statusCommand } from "./commands/status.js";

const COMMANDS = [charactersCommand, helpCommand, simCommand, statusCommand];

export type RegisterOptions = {
    discordToken: string;
    discordAppId: string;
    /** Guild id pins commands to one guild (instant); empty = global (~1h). */
    discordGuildId: string | null;
};

export async function registerCommands(opts: RegisterOptions): Promise<void> {
    const rest = new REST({ version: "10" }).setToken(opts.discordToken);
    const route = opts.discordGuildId
        ? Routes.applicationGuildCommands(opts.discordAppId, opts.discordGuildId)
        : Routes.applicationCommands(opts.discordAppId);
    log.info(
        {
            scope: opts.discordGuildId ? `guild:${opts.discordGuildId}` : "global",
            count: COMMANDS.length,
        },
        "registering slash commands",
    );
    await rest.put(route, { body: COMMANDS });
    log.info("slash commands registered");
}
