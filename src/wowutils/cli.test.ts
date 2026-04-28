import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { upsertCharacter } from "../db/repo.js";
import { simJobs } from "../db/schema.js";
import { makeTestDb } from "../test-utils/db.js";
import { sampleCharacter as sample } from "../test-utils/factories.js";
import { runScriptGenerator, type IO } from "./cli.js";
import { loadPreferences } from "./preferences.js";

function tmpPaths() {
    const dir = mkdtempSync(join(tmpdir(), "wowutils-cli-"));
    return {
        prefsPath: join(dir, "prefs.json"),
        scriptPath: join(dir, "script.js"),
    };
}

function insertJob(
    db: ReturnType<typeof makeTestDb>,
    opts: { characterId: number; reportUrl: string },
): void {
    db.insert(simJobs)
        .values({
            characterId: opts.characterId,
            simcSnapshot: "raw",
            status: "done",
            reportUrl: opts.reportUrl,
        })
        .run();
}

const noPromptIO: IO = {
    info: () => {},
    promptSpec: async () => {
        throw new Error("promptSpec should not be called");
    },
};

describe("runScriptGenerator", () => {
    it("writes a script for single-spec characters without prompting", async () => {
        const db = makeTestDb();
        const c = upsertCharacter(
            db,
            "u1",
            sample({ name: "Apex", className: "hunter", spec: "marksmanship" }),
            "raw",
        );
        insertJob(db, { characterId: c.id, reportUrl: "https://x/r/mm" });
        const { prefsPath, scriptPath } = tmpPaths();

        const result = await runScriptGenerator({
            db,
            prefsPath,
            scriptPath,
            io: noPromptIO,
        });

        expect(result.ready).toHaveLength(1);
        expect(result.ready[0]!.characterName).toBe("Apex");
        expect(result.skipped).toEqual([]);
        const script = readFileSync(scriptPath, "utf8");
        expect(script).toContain("https://x/r/mm");
    });

    it("prompts for multi-spec characters and persists the chosen preference", async () => {
        const db = makeTestDb();
        const bm = upsertCharacter(
            db,
            "u1",
            sample({ name: "Apex", className: "hunter", spec: "beast_mastery" }),
            "raw",
        );
        const mm = upsertCharacter(
            db,
            "u1",
            sample({ name: "Apex", className: "hunter", spec: "marksmanship" }),
            "raw",
        );
        insertJob(db, { characterId: bm.id, reportUrl: "https://x/r/bm" });
        insertJob(db, { characterId: mm.id, reportUrl: "https://x/r/mm" });
        const { prefsPath, scriptPath } = tmpPaths();

        const promptSpec = vi.fn(async () => "marksmanship");
        const result = await runScriptGenerator({
            db,
            prefsPath,
            scriptPath,
            io: { info: () => {}, promptSpec },
        });

        expect(promptSpec).toHaveBeenCalledTimes(1);
        expect(result.ready).toHaveLength(1);
        expect(result.ready[0]!.spec).toBe("Marksmanship");
        expect(loadPreferences(prefsPath)).toEqual({ "us|area-52|apex": "marksmanship" });
    });

    it("uses a stored preference on the next run without re-prompting", async () => {
        const db = makeTestDb();
        const bm = upsertCharacter(
            db,
            "u1",
            sample({ name: "Apex", className: "hunter", spec: "beast_mastery" }),
            "raw",
        );
        const mm = upsertCharacter(
            db,
            "u1",
            sample({ name: "Apex", className: "hunter", spec: "marksmanship" }),
            "raw",
        );
        insertJob(db, { characterId: bm.id, reportUrl: "https://x/r/bm" });
        insertJob(db, { characterId: mm.id, reportUrl: "https://x/r/mm" });
        const { prefsPath, scriptPath } = tmpPaths();

        // First run: pick BM.
        await runScriptGenerator({
            db,
            prefsPath,
            scriptPath,
            io: { info: () => {}, promptSpec: async () => "beast_mastery" },
        });
        // Second run: should not prompt.
        const promptSpec = vi.fn(async () => "marksmanship");
        const result = await runScriptGenerator({
            db,
            prefsPath,
            scriptPath,
            io: { info: () => {}, promptSpec },
        });
        expect(promptSpec).not.toHaveBeenCalled();
        expect(result.ready[0]!.spec).toBe("Beast Mastery");
    });

    it("treats null from the prompt as a skip and excludes that character from the script", async () => {
        const db = makeTestDb();
        const bm = upsertCharacter(
            db,
            "u1",
            sample({ name: "Apex", className: "hunter", spec: "beast_mastery" }),
            "raw",
        );
        const mm = upsertCharacter(
            db,
            "u1",
            sample({ name: "Apex", className: "hunter", spec: "marksmanship" }),
            "raw",
        );
        insertJob(db, { characterId: bm.id, reportUrl: "https://x/r/bm" });
        insertJob(db, { characterId: mm.id, reportUrl: "https://x/r/mm" });
        const { prefsPath, scriptPath } = tmpPaths();

        const result = await runScriptGenerator({
            db,
            prefsPath,
            scriptPath,
            io: { info: () => {}, promptSpec: async () => null },
        });
        expect(result.ready).toEqual([]);
        expect(result.skipped).toHaveLength(1);
        expect(loadPreferences(prefsPath)).toEqual({});
    });

    it("emits an empty script when the database has no done reports", async () => {
        const db = makeTestDb();
        const { prefsPath, scriptPath } = tmpPaths();
        const info = vi.fn();
        const result = await runScriptGenerator({
            db,
            prefsPath,
            scriptPath,
            io: { info, promptSpec: noPromptIO.promptSpec },
        });
        expect(result.ready).toEqual([]);
        expect(existsSync(scriptPath)).toBe(true);
        expect(info).toHaveBeenCalledWith("No done reports found in the database.");
    });
});
