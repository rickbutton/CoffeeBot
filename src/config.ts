import "dotenv/config";
import { z } from "zod";

const Schema = z.object({
    DISCORD_TOKEN: z.string().min(10, "DISCORD_TOKEN is required"),
    DISCORD_APP_ID: z.string().min(1, "DISCORD_APP_ID is required"),
    DISCORD_GUILD_ID: z.string().optional(),
    DISCORD_ADMIN_USER_IDS: z.string().default(""),
    DB_PATH: z.string().default("./data/bot.db"),
    LOG_LEVEL: z.string().default("info"),

    SIM_MIN_DELAY_SECONDS: z.coerce.number().int().min(1).default(75),
    SIM_MAX_DELAY_SECONDS: z.coerce.number().int().min(1).default(120),
    SIM_DAILY_CAP: z.coerce.number().int().min(1).default(30),

    RAIDBOTS_EXECUTOR: z.enum(["stub", "playwright"]).default("stub"),
    PLAYWRIGHT_USER_DATA_DIR: z.string().default("./data/chromium-profile"),
    PLAYWRIGHT_HEADLESS: z.coerce.boolean().default(true),
    RAIDBOTS_EMAIL: z.string().optional(),
    RAIDBOTS_PASSWORD: z.string().optional(),

    QELIVE_USER_DATA_DIR: z.string().default("./data/qelive-profile"),

    REQUEST_SIMCS_CRON: z.string().default(""),
    REQUEST_SIMCS_STALE_DAYS: z.coerce.number().int().min(1).default(7),

    WOWAUDIT_API_KEY: z.string().optional(),
    WOWAUDIT_BASE_URL: z.string().default("https://wowaudit.com/api"),
});

export type Config = {
    discordToken: string;
    discordAppId: string;
    discordGuildId: string | null;
    adminUserIds: Set<string>;
    dbPath: string;
    sim: {
        minDelaySeconds: number;
        maxDelaySeconds: number;
        dailyCap: number;
    };
    raidbots: {
        executor: "stub" | "playwright";
        userDataDir: string;
        headless: boolean;
        credentials: { email: string; password: string } | null;
    };
    qelive: {
        userDataDir: string;
        headless: boolean;
    };
    requestSimcs: {
        cron: string | null;
        staleDays: number;
    };
    wowaudit: { apiKey: string; baseUrl: string } | null;
};

export function loadConfig(): Config {
    const parsed = Schema.safeParse(process.env);
    if (!parsed.success) {
        const issues = parsed.error.issues
            .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
            .join("\n");
        throw new Error(`Invalid environment configuration:\n${issues}`);
    }
    const env = parsed.data;
    if (env.SIM_MIN_DELAY_SECONDS > env.SIM_MAX_DELAY_SECONDS) {
        throw new Error("SIM_MIN_DELAY_SECONDS must be <= SIM_MAX_DELAY_SECONDS");
    }
    return {
        discordToken: env.DISCORD_TOKEN,
        discordAppId: env.DISCORD_APP_ID,
        discordGuildId: env.DISCORD_GUILD_ID ?? null,
        adminUserIds: new Set(
            env.DISCORD_ADMIN_USER_IDS.split(",")
                .map((s) => s.trim())
                .filter(Boolean),
        ),
        dbPath: env.DB_PATH,
        sim: {
            minDelaySeconds: env.SIM_MIN_DELAY_SECONDS,
            maxDelaySeconds: env.SIM_MAX_DELAY_SECONDS,
            dailyCap: env.SIM_DAILY_CAP,
        },
        raidbots: {
            executor: env.RAIDBOTS_EXECUTOR,
            userDataDir: env.PLAYWRIGHT_USER_DATA_DIR,
            headless: env.PLAYWRIGHT_HEADLESS,
            credentials:
                env.RAIDBOTS_EMAIL && env.RAIDBOTS_PASSWORD
                    ? { email: env.RAIDBOTS_EMAIL, password: env.RAIDBOTS_PASSWORD }
                    : null,
        },
        qelive: {
            userDataDir: env.QELIVE_USER_DATA_DIR,
            headless: env.PLAYWRIGHT_HEADLESS,
        },
        requestSimcs: {
            cron: env.REQUEST_SIMCS_CRON.trim() || null,
            staleDays: env.REQUEST_SIMCS_STALE_DAYS,
        },
        wowaudit: env.WOWAUDIT_API_KEY
            ? { apiKey: env.WOWAUDIT_API_KEY, baseUrl: env.WOWAUDIT_BASE_URL }
            : null,
    };
}

