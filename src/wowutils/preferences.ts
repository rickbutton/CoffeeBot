import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Stored as `{ "<region>|<realm>|<name>": "<spec>" }` (all lowercase). The
 * spec value is the DB form (snake_case, e.g. `beast_mastery`). This file
 * is written to `data/` and not committed.
 */
export type SpecPreferences = Record<string, string>;

export function preferenceKey(region: string, realm: string, name: string): string {
    return `${region.toLowerCase()}|${realm.toLowerCase()}|${name.toLowerCase()}`;
}

export function loadPreferences(path: string): SpecPreferences {
    let raw: string;
    try {
        raw = readFileSync(path, "utf8");
    } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
        throw err;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return {};
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: SpecPreferences = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === "string") out[k] = v;
    }
    return out;
}

export function savePreferences(path: string, prefs: SpecPreferences): void {
    mkdirSync(dirname(path), { recursive: true });
    const sorted = Object.fromEntries(Object.entries(prefs).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(path, JSON.stringify(sorted, null, 2) + "\n", "utf8");
}
