import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    // Wipe relevant keys from env before each test for determinism.
    for (const k of Object.keys(process.env)) {
        if (
            k.startsWith("DISCORD_") ||
            k.startsWith("SIM_") ||
            k.startsWith("RAIDBOTS_") ||
            k.startsWith("PLAYWRIGHT_") ||
            k.startsWith("QELIVE_") ||
            k.startsWith("REQUEST_SIMCS_") ||
            k === "DB_PATH" ||
            k === "LOG_LEVEL"
        ) {
            delete process.env[k];
        }
    }
});

afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
});

describe("loadConfig", () => {
    it("rejects missing DISCORD_TOKEN", () => {
        process.env.DISCORD_APP_ID = "appid";
        expect(() => loadConfig()).toThrow(/Invalid environment/);
    });

    it("loads minimal config with sensible defaults", () => {
        process.env.DISCORD_TOKEN = "x".repeat(20);
        process.env.DISCORD_APP_ID = "appid";
        const cfg = loadConfig();
        expect(cfg.discordToken.length).toBeGreaterThanOrEqual(10);
        expect(cfg.discordAppId).toBe("appid");
        expect(cfg.discordGuildId).toBe(null);
        expect(cfg.adminUserIds.size).toBe(0);
        expect(cfg.dbPath).toBe("./data/bot.db");
        expect(cfg.sim).toEqual({ minDelaySeconds: 75, maxDelaySeconds: 120, dailyCap: 30 });
        expect(cfg.raidbots.executor).toBe("stub");
        expect(cfg.raidbots.credentials).toBe(null);
        expect(cfg.qelive.userDataDir).toBe("./data/qelive-profile");
        expect(cfg.qelive.headless).toBe(true);
        expect(cfg.requestSimcs.cron).toBe(null);
        expect(cfg.requestSimcs.staleDays).toBe(7);
    });

    it("parses admin ids, credentials, and cron string", () => {
        process.env.DISCORD_TOKEN = "x".repeat(20);
        process.env.DISCORD_APP_ID = "appid";
        process.env.DISCORD_GUILD_ID = "guild";
        process.env.DISCORD_ADMIN_USER_IDS = "a, b , ,c";
        process.env.RAIDBOTS_EMAIL = "e@x";
        process.env.RAIDBOTS_PASSWORD = "p";
        process.env.REQUEST_SIMCS_CRON = "0 9 * * 1";
        const cfg = loadConfig();
        expect(cfg.discordGuildId).toBe("guild");
        expect([...cfg.adminUserIds].sort()).toEqual(["a", "b", "c"]);
        expect(cfg.raidbots.credentials).toEqual({ email: "e@x", password: "p" });
        expect(cfg.requestSimcs.cron).toBe("0 9 * * 1");
    });

    it("rejects min > max sim delay", () => {
        process.env.DISCORD_TOKEN = "x".repeat(20);
        process.env.DISCORD_APP_ID = "appid";
        process.env.SIM_MIN_DELAY_SECONDS = "200";
        process.env.SIM_MAX_DELAY_SECONDS = "100";
        expect(() => loadConfig()).toThrow(/SIM_MIN_DELAY_SECONDS/);
    });
});
