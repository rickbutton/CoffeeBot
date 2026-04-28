import { Client, GatewayIntentBits, Partials, type ClientOptions } from "discord.js";

export function createClient(): Client {
    const options: ClientOptions = {
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.DirectMessages,
            GatewayIntentBits.MessageContent,
        ],
        // Channel partial is required to receive DMs that aren't already cached.
        partials: [Partials.Channel, Partials.Message],
    };
    return new Client(options);
}
