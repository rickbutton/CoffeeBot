import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { characters, simJobs } from "../db/schema.js";
import { preferenceKey, type SpecPreferences } from "./preferences.js";
import { classNameToWowutilsKey, specToWowutilsAlt } from "./spec.js";

export type WowutilsReport = {
    /** Character (login) name as wowutils displays it in `button[title="Import droptimizer for X"]`. */
    characterName: string;
    /** Wowutils path form (`hunter`, `deathknight`, `demonhunter`, ...). Used to disambiguate same-name rows. */
    classKey: string | null;
    /** Title Case spec — used for log labels in the script; not part of row matching. */
    spec: string | null;
    reportUrl: string;
};

/** A single (spec, latest-report) option for one character. */
export type SpecOption = {
    /** DB form (`beast_mastery`). */
    spec: string;
    /** Title Case form for display (`Beast Mastery`). */
    specDisplay: string;
    reportUrl: string;
};

/** All the latest-per-spec reports for a single in-game character. */
export type CharacterGroup = {
    /** Stable key used as the preference map key: `region|realm|name` lowercased. */
    key: string;
    region: string;
    realm: string;
    characterName: string;
    classKey: string | null;
    /** One entry per spec the player has simmed. */
    options: SpecOption[];
};

export type ResolveResult = {
    /** Reports ready to upload — either there was only one spec, or a stored preference picked it. */
    ready: WowutilsReport[];
    /** Characters with multiple specs and no recorded preference. The CLI should prompt for these. */
    needsChoice: CharacterGroup[];
};

/**
 * Group every "done" sim job that has a report URL by in-game character.
 * Within each group, keeps the most-recent report per spec (most-recent
 * winning by simJob.id descending).
 */
export function groupReportsByCharacter(db: Db): CharacterGroup[] {
    const rows = db
        .select({
            jobId: simJobs.id,
            reportUrl: simJobs.reportUrl,
            characterName: characters.name,
            realm: characters.realm,
            region: characters.region,
            className: characters.className,
            spec: characters.spec,
        })
        .from(simJobs)
        .leftJoin(characters, eq(simJobs.characterId, characters.id))
        .where(and(eq(simJobs.status, "done"), isNotNull(simJobs.reportUrl)))
        .orderBy(sql`${simJobs.id} DESC`)
        .all();

    const groups = new Map<string, CharacterGroup>();
    const seenSpecPerGroup = new Map<string, Set<string>>();

    for (const row of rows) {
        if (!row.reportUrl || !row.characterName || !row.realm || !row.region || !row.spec) {
            continue;
        }
        const key = preferenceKey(row.region, row.realm, row.characterName);
        let group = groups.get(key);
        if (!group) {
            group = {
                key,
                region: row.region,
                realm: row.realm,
                characterName: row.characterName,
                classKey: classNameToWowutilsKey(row.className),
                options: [],
            };
            groups.set(key, group);
            seenSpecPerGroup.set(key, new Set());
        }
        const seenSpecs = seenSpecPerGroup.get(key)!;
        if (seenSpecs.has(row.spec)) continue;
        seenSpecs.add(row.spec);
        group.options.push({
            spec: row.spec,
            specDisplay: specToWowutilsAlt(row.spec) ?? row.spec,
            reportUrl: row.reportUrl,
        });
    }

    return [...groups.values()].sort((a, b) => a.characterName.localeCompare(b.characterName));
}

/**
 * Apply a preferences map to character groups. Single-spec characters resolve
 * automatically; multi-spec characters either resolve via a stored preference
 * (when that preference still names a known spec) or get returned in
 * `needsChoice` for the caller to prompt about.
 */
export function resolveReports(
    groups: CharacterGroup[],
    preferences: SpecPreferences,
): ResolveResult {
    const ready: WowutilsReport[] = [];
    const needsChoice: CharacterGroup[] = [];
    for (const group of groups) {
        if (group.options.length === 0) continue;
        if (group.options.length === 1) {
            ready.push(toReport(group, group.options[0]!));
            continue;
        }
        const preferred = preferences[group.key];
        const match = preferred ? group.options.find((o) => o.spec === preferred) : undefined;
        if (match) {
            ready.push(toReport(group, match));
        } else {
            needsChoice.push(group);
        }
    }
    return { ready, needsChoice };
}

function toReport(group: CharacterGroup, option: SpecOption): WowutilsReport {
    return {
        characterName: group.characterName,
        classKey: group.classKey,
        spec: option.specDisplay,
        reportUrl: option.reportUrl,
    };
}
