import type Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { upsertCharacter } from "../db/repo.js";
import { simJobs } from "../db/schema.js";
import { makeTestDb } from "../test-utils/db.js";
import { sampleCharacter as sample } from "../test-utils/factories.js";
import {
    type CharacterGroup,
    groupReportsByCharacter,
    resolveReports,
} from "./select.js";

function rawSqlite(db: ReturnType<typeof makeTestDb>): Database.Database {
    return (db as unknown as { $client: Database.Database }).$client;
}

function insertJob(
    db: ReturnType<typeof makeTestDb>,
    opts: {
        characterId: number;
        status?: "queued" | "running" | "done" | "failed" | "cancelled";
        reportUrl?: string | null;
    },
): number {
    return db
        .insert(simJobs)
        .values({
            characterId: opts.characterId,
            simcSnapshot: "raw",
            status: opts.status ?? "done",
            reportUrl: opts.reportUrl === undefined ? "https://x/r/abc" : opts.reportUrl,
        })
        .returning({ id: simJobs.id })
        .get().id;
}

describe("groupReportsByCharacter", () => {
    it("groups multiple specs of one in-game character into one group", () => {
        const db = makeTestDb();
        const c1 = upsertCharacter(
            db,
            "u1",
            sample({ name: "Apex", className: "hunter", spec: "beast_mastery" }),
            "raw",
        );
        const c2 = upsertCharacter(
            db,
            "u1",
            sample({ name: "Apex", className: "hunter", spec: "marksmanship" }),
            "raw",
        );
        insertJob(db, { characterId: c1.id, reportUrl: "https://x/r/bm" });
        insertJob(db, { characterId: c2.id, reportUrl: "https://x/r/mm" });
        const groups = groupReportsByCharacter(db);
        expect(groups).toHaveLength(1);
        const g = groups[0]!;
        expect(g.characterName).toBe("Apex");
        expect(g.classKey).toBe("hunter");
        expect(g.options.map((o) => o.spec).sort()).toEqual(["beast_mastery", "marksmanship"]);
    });

    it("keeps the most-recent reportUrl per spec inside a group", () => {
        const db = makeTestDb();
        const c = upsertCharacter(
            db,
            "u1",
            sample({ name: "Apex", className: "hunter", spec: "beast_mastery" }),
            "raw",
        );
        insertJob(db, { characterId: c.id, reportUrl: "https://x/r/old" });
        insertJob(db, { characterId: c.id, reportUrl: "https://x/r/new" });
        const groups = groupReportsByCharacter(db);
        expect(groups[0]!.options).toEqual([
            { spec: "beast_mastery", specDisplay: "Beast Mastery", reportUrl: "https://x/r/new" },
        ]);
    });

    it("creates separate groups for the same name on different realms", () => {
        const db = makeTestDb();
        const a = upsertCharacter(
            db,
            "u1",
            sample({ name: "Apex", realm: "illidan", className: "mage", spec: "arcane" }),
            "raw",
        );
        const b = upsertCharacter(
            db,
            "u2",
            sample({
                name: "Apex",
                realm: "frostmane",
                className: "hunter",
                spec: "marksmanship",
            }),
            "raw",
        );
        insertJob(db, { characterId: a.id });
        insertJob(db, { characterId: b.id });
        expect(groupReportsByCharacter(db)).toHaveLength(2);
    });

    it("ignores rows with missing fields, non-done status, or null reportUrl", () => {
        const db = makeTestDb();
        const c = upsertCharacter(db, "u1", sample({ name: "Apex" }), "raw");
        insertJob(db, { characterId: c.id, status: "queued" });
        insertJob(db, { characterId: c.id, status: "failed" });
        insertJob(db, { characterId: c.id, status: "done", reportUrl: null });

        const sqlite = rawSqlite(db);
        sqlite.pragma("foreign_keys = OFF");
        sqlite
            .prepare(
                "INSERT INTO sim_jobs (character_id, status, simc_snapshot, report_url) VALUES (?, 'done', 'raw', ?)",
            )
            .run(9999, "https://x/r/orphan");
        sqlite.pragma("foreign_keys = ON");

        expect(groupReportsByCharacter(db)).toEqual([]);
    });

    it("sorts groups alphabetically by character name", () => {
        const db = makeTestDb();
        const a = upsertCharacter(
            db,
            "u1",
            sample({ name: "Zelda", className: "mage", spec: "arcane" }),
            "raw",
        );
        const b = upsertCharacter(
            db,
            "u2",
            sample({ name: "Apex", className: "hunter", spec: "marksmanship" }),
            "raw",
        );
        insertJob(db, { characterId: a.id });
        insertJob(db, { characterId: b.id });
        const groups = groupReportsByCharacter(db);
        expect(groups.map((g) => g.characterName)).toEqual(["Apex", "Zelda"]);
    });
});

function makeGroup(overrides: Partial<CharacterGroup> = {}): CharacterGroup {
    return {
        key: "us|illidan|apex",
        region: "us",
        realm: "illidan",
        characterName: "Apex",
        classKey: "hunter",
        options: [
            { spec: "beast_mastery", specDisplay: "Beast Mastery", reportUrl: "https://x/r/bm" },
        ],
        ...overrides,
    };
}

describe("resolveReports", () => {
    it("auto-resolves single-spec groups", () => {
        const r = resolveReports([makeGroup()], {});
        expect(r.needsChoice).toEqual([]);
        expect(r.ready).toEqual([
            {
                characterName: "Apex",
                classKey: "hunter",
                spec: "Beast Mastery",
                reportUrl: "https://x/r/bm",
            },
        ]);
    });

    it("uses a stored preference for multi-spec groups", () => {
        const group = makeGroup({
            options: [
                {
                    spec: "beast_mastery",
                    specDisplay: "Beast Mastery",
                    reportUrl: "https://x/r/bm",
                },
                {
                    spec: "marksmanship",
                    specDisplay: "Marksmanship",
                    reportUrl: "https://x/r/mm",
                },
            ],
        });
        const r = resolveReports([group], { "us|illidan|apex": "marksmanship" });
        expect(r.needsChoice).toEqual([]);
        expect(r.ready).toEqual([
            {
                characterName: "Apex",
                classKey: "hunter",
                spec: "Marksmanship",
                reportUrl: "https://x/r/mm",
            },
        ]);
    });

    it("returns multi-spec groups without a preference as needsChoice", () => {
        const group = makeGroup({
            options: [
                {
                    spec: "beast_mastery",
                    specDisplay: "Beast Mastery",
                    reportUrl: "https://x/r/bm",
                },
                {
                    spec: "marksmanship",
                    specDisplay: "Marksmanship",
                    reportUrl: "https://x/r/mm",
                },
            ],
        });
        const r = resolveReports([group], {});
        expect(r.ready).toEqual([]);
        expect(r.needsChoice).toEqual([group]);
    });

    it("falls back to needsChoice when the stored preference names a spec the character no longer has", () => {
        const group = makeGroup({
            options: [
                {
                    spec: "beast_mastery",
                    specDisplay: "Beast Mastery",
                    reportUrl: "https://x/r/bm",
                },
                {
                    spec: "marksmanship",
                    specDisplay: "Marksmanship",
                    reportUrl: "https://x/r/mm",
                },
            ],
        });
        const r = resolveReports([group], { "us|illidan|apex": "survival" });
        expect(r.needsChoice).toEqual([group]);
    });

    it("ignores groups with no options", () => {
        const r = resolveReports([makeGroup({ options: [] })], {});
        expect(r.ready).toEqual([]);
        expect(r.needsChoice).toEqual([]);
    });
});
