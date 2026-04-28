import { describe, expect, it } from "vitest";
import { Client } from "discord.js";
import { createClient } from "./client.js";

describe("createClient", () => {
    it("returns a discord.js Client with required intents and partials", () => {
        const c = createClient();
        expect(c).toBeInstanceOf(Client);
        // Sanity: configured options are reflected.
        expect(c.options.partials?.length).toBeGreaterThan(0);
        expect(Array.isArray(c.options.intents) || typeof c.options.intents === "object").toBe(true);
    });
});
