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
    SIM_ACTIVE_HOURS_UTC: z.string().default(""),

    RAIDBOTS_EXECUTOR: z.enum(["stub", "playwright"]).default("stub"),
    PLAYWRIGHT_USER_DATA_DIR: z.string().default("./data/chromium-profile"),
    PLAYWRIGHT_HEADLESS: z.coerce.boolean().default(true),
    RAIDBOTS_EMAIL: z.string().optional(),
    RAIDBOTS_PASSWORD: z.string().optional(),

    REQUEST_SIMCS_CRON: z.string().default(""),
    REQUEST_SIMCS_STALE_DAYS: z.coerce.number().int().min(1).default(7),
});

export type ActiveHours = { startHour: number; endHour: number } | null;

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
        activeHoursUtc: ActiveHours;
    };
    raidbots: {
        executor: "stub" | "playwright";
        userDataDir: string;
        headless: boolean;
        credentials: { email: string; password: string } | null;
    };
    requestSimcs: {
        cron: string | null;
        staleDays: number;
    };
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
            activeHoursUtc: parseActiveHours(env.SIM_ACTIVE_HOURS_UTC),
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
        requestSimcs: {
            cron: env.REQUEST_SIMCS_CRON.trim() || null,
            staleDays: env.REQUEST_SIMCS_STALE_DAYS,
        },
    };
}

function parseActiveHours(raw: string): ActiveHours {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const m = /^(\d{1,2})\s*-\s*(\d{1,2})$/.exec(trimmed);
    if (!m) {
        throw new Error(
            `SIM_ACTIVE_HOURS_UTC must be "HH-HH" (e.g. "03-10") or empty; got "${raw}"`,
        );
    }
    const startHour = Number.parseInt(m[1]!, 10);
    const endHour = Number.parseInt(m[2]!, 10);
    if (startHour < 0 || startHour > 23 || endHour < 0 || endHour > 24) {
        throw new Error(`SIM_ACTIVE_HOURS_UTC hours out of range: "${raw}"`);
    }
    return { startHour, endHour };
}
