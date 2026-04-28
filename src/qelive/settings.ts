// Edit DEFAULT_UPGRADE_FINDER_SETTINGS to change driver behavior. The QELive UI
// allows up to two raid difficulties at once; we default to just "Mythic (Max)".

export type QELiveSpec =
    | "Holy Paladin"
    | "Restoration Druid"
    | "Preservation Evoker"
    | "Discipline Priest"
    | "Holy Priest"
    | "Restoration Shaman"
    | "Mistweaver Monk";

export type RaidDifficulty =
    | "LFR"
    | "LFR (Max)"
    | "Normal"
    | "Normal (Max)"
    | "Heroic"
    | "Heroic (Max)"
    | "Mythic"
    | "Mythic (Max)";

export type ContentMode = "Raid" | "Dungeon";

export type UpgradeFinderSettings = {
    spec: QELiveSpec;
    contentMode: ContentMode;
    /** QELive caps at two simultaneous raid difficulties. */
    raidDifficulties: RaidDifficulty[];
    upgradeAllToMax: boolean;
    upgradeVaultToMax: boolean;
};

export const DEFAULT_UPGRADE_FINDER_SETTINGS: Omit<UpgradeFinderSettings, "spec"> = {
    contentMode: "Raid",
    raidDifficulties: ["Mythic (Max)"],
    upgradeAllToMax: true,
    upgradeVaultToMax: true,
};

// Maps a SimC `(className, specName)` pair to QELive's spec dropdown label.
// Returns null for non-healer specs — QELive only sims healers.
const CLASS_SPEC_TO_QELIVE: Record<string, QELiveSpec> = {
    "druid:restoration": "Restoration Druid",
    "evoker:preservation": "Preservation Evoker",
    "monk:mistweaver": "Mistweaver Monk",
    "paladin:holy": "Holy Paladin",
    "priest:discipline": "Discipline Priest",
    "priest:holy": "Holy Priest",
    "shaman:restoration": "Restoration Shaman",
};

export function qeliveSpecFor(className: string, spec: string | null): QELiveSpec | null {
    if (!spec) return null;
    return CLASS_SPEC_TO_QELIVE[`${className}:${spec}`] ?? null;
}
