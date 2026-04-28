import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { type Db } from "../db/client.js";
import { loadPreferences, savePreferences, type SpecPreferences } from "./preferences.js";
import {
    type CharacterGroup,
    groupReportsByCharacter,
    resolveReports,
    type WowutilsReport,
} from "./select.js";
import { buildWowutilsScript } from "./script.js";

export type IO = {
    /** Resolve to a chosen spec (DB form, e.g. `marksmanship`) or null to skip the character. */
    promptSpec: (group: CharacterGroup) => Promise<string | null>;
    info: (msg: string) => void;
};

export type RunOpts = {
    db: Db;
    prefsPath: string;
    scriptPath: string;
    io: IO;
};

export type RunResult = {
    ready: WowutilsReport[];
    skipped: CharacterGroup[];
    scriptPath: string;
    prefsPath: string;
};

export async function runScriptGenerator(opts: RunOpts): Promise<RunResult> {
    const { db, prefsPath, scriptPath, io } = opts;
    const groups = groupReportsByCharacter(db);
    if (groups.length === 0) {
        io.info("No done reports found in the database.");
        const empty = buildWowutilsScript([]);
        mkdirSync(dirname(scriptPath), { recursive: true });
        writeFileSync(scriptPath, empty, "utf8");
        return { ready: [], skipped: [], scriptPath, prefsPath };
    }

    const preferences = loadPreferences(prefsPath);
    const initial = resolveReports(groups, preferences);
    let ready = initial.ready;
    const needsChoice = initial.needsChoice;

    const skipped: CharacterGroup[] = [];
    if (needsChoice.length > 0) {
        io.info(
            `${needsChoice.length} character(s) have multiple specs simmed. Pick which one to upload.`,
        );
        const updates: SpecPreferences = {};
        for (const group of needsChoice) {
            const choice = await io.promptSpec(group);
            if (choice === null) {
                skipped.push(group);
                continue;
            }
            updates[group.key] = choice;
        }
        if (Object.keys(updates).length > 0) {
            const merged = { ...preferences, ...updates };
            savePreferences(prefsPath, merged);
            io.info(`Saved ${Object.keys(updates).length} preference(s) to ${prefsPath}.`);
            ({ ready } = resolveReports(groups, merged));
        }
    }

    const script = buildWowutilsScript(ready);
    mkdirSync(dirname(scriptPath), { recursive: true });
    writeFileSync(scriptPath, script, "utf8");
    io.info(`Wrote console script for ${ready.length} character(s) to ${scriptPath}.`);
    if (skipped.length > 0) {
        io.info(
            `Skipped ${skipped.length} (no choice given): ${skipped.map((g) => g.characterName).join(", ")}.`,
        );
    }
    return { ready, skipped, scriptPath, prefsPath };
}
