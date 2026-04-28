import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
    discordId: text("discord_id").primaryKey(),
    isAdmin: integer("is_admin", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp" })
        .notNull()
        .default(sql`(unixepoch())`),
});

// Tiny key/value store for runtime config the bot remembers across restarts (e.g. status channel).
export const botState = sqliteTable("bot_state", {
    key: text("key").primaryKey(),
    value: text("value").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
        .notNull()
        .default(sql`(unixepoch())`),
});

export const characters = sqliteTable(
    "characters",
    {
        id: integer("id").primaryKey({ autoIncrement: true }),
        discordId: text("discord_id")
            .notNull()
            .references(() => users.discordId, { onDelete: "cascade" }),
        name: text("name").notNull(),
        realm: text("realm").notNull(),
        region: text("region").notNull(),
        className: text("class_name").notNull(),
        spec: text("spec"),
        level: integer("level"),
        race: text("race"),
        // Nullable: admin can pre-register via /characters register before the player submits.
        simc: text("simc"),
        updatedAt: integer("updated_at", { mode: "timestamp" })
            .notNull()
            .default(sql`(unixepoch())`),
        lastRequestedAt: integer("last_requested_at", { mode: "timestamp" }),
    },
    (t) => ({
        uqOwnerNameRealmSpec: uniqueIndex("characters_owner_name_realm_spec_uq").on(
            t.discordId,
            t.region,
            t.realm,
            t.name,
            t.spec,
        ),
        ixOwner: index("characters_owner_idx").on(t.discordId),
    }),
);

export const JOB_STATUSES = ["queued", "running", "done", "failed", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const simJobs = sqliteTable(
    "sim_jobs",
    {
        id: integer("id").primaryKey({ autoIncrement: true }),
        characterId: integer("character_id")
            .notNull()
            .references(() => characters.id, { onDelete: "cascade" }),
        status: text("status", { enum: JOB_STATUSES }).notNull().default("queued"),
        simcSnapshot: text("simc_snapshot").notNull(),
        // Source-agnostic report URL. The URL pattern itself encodes the tool
        // (raidbots.com/simbot/report/... today; later, e.g. questionablyepic.com).
        reportUrl: text("report_url"),
        error: text("error"),
        createdAt: integer("created_at", { mode: "timestamp" })
            .notNull()
            .default(sql`(unixepoch())`),
        startedAt: integer("started_at", { mode: "timestamp" }),
        completedAt: integer("completed_at", { mode: "timestamp" }),
        wowauditUploadedAt: integer("wowaudit_uploaded_at", { mode: "timestamp" }),
    },
    (t) => ({
        ixStatus: index("sim_jobs_status_idx").on(t.status),
        ixCharacter: index("sim_jobs_character_idx").on(t.characterId),
    }),
);

export type Character = typeof characters.$inferSelect;
export type SimJob = typeof simJobs.$inferSelect;
