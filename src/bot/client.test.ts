import { describe, expect, it } from "vitest";
import { Client, GatewayIntentBits, IntentsBitField, Partials } from "discord.js";
import { createClient } from "./client.js";

describe("createClient", () => {
    it("returns a discord.js Client with the intents the bot relies on", () => {
        const c = createClient();
        expect(c).toBeInstanceOf(Client);
        const intents = new IntentsBitField(c.options.intents);
        expect(intents.has(GatewayIntentBits.Guilds)).toBe(true);
        expect(intents.has(GatewayIntentBits.GuildMessages)).toBe(true);
        expect(intents.has(GatewayIntentBits.DirectMessages)).toBe(true);
        // MessageContent is privileged and required so we can read the simc paste body.
        expect(intents.has(GatewayIntentBits.MessageContent)).toBe(true);
    });

    it("opts into Channel + Message partials so uncached DMs still fire events", () => {
        const c = createClient();
        expect(c.options.partials).toContain(Partials.Channel);
        expect(c.options.partials).toContain(Partials.Message);
    });
});
