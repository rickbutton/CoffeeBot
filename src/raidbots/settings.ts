// Edit SIM_SETTINGS to change behavior. "Upgrade items up to" is hard-coded to max (6/6) and
// "Upgrade all equipped gear" is hard-coded on — see apply-settings.ts.

export type Difficulty = "lfr" | "normal" | "heroic" | "mythic";

export type FightStyle =
    | "patchwerk"
    | "dungeon_slice"
    | "target_dummy"
    | "execute_patchwerk"
    | "hectic_add_cleave"
    | "light_movement"
    | "heavy_movement"
    | "casting_patchwerk"
    | "cleave_add";

export type SimSettings = {
    /** Source label exactly as it appears in the droptimizer Sources list. */
    source: string;
    difficulty: Difficulty;
    fightStyle: FightStyle;
};

export const SIM_SETTINGS: SimSettings = {
    source: "Season 1 Raids",
    difficulty: "mythic",
    fightStyle: "patchwerk",
};

const DIFFICULTY_LABEL: Record<Difficulty, string> = {
    lfr: "Raid Finder",
    normal: "Normal",
    heroic: "Heroic",
    mythic: "Mythic",
};

const FIGHT_STYLE_LABEL: Record<FightStyle, string> = {
    patchwerk: "Patchwerk",
    dungeon_slice: "Dungeon Slice",
    target_dummy: "Target Dummy",
    execute_patchwerk: "Execute Patchwerk",
    hectic_add_cleave: "Hectic Add Cleave",
    light_movement: "Light Movement",
    heavy_movement: "Heavy Movement",
    casting_patchwerk: "Casting Patchwerk",
    cleave_add: "Cleave Add",
};

export const difficultyLabel = (d: Difficulty): string => DIFFICULTY_LABEL[d];
export const fightStyleLabel = (f: FightStyle): string => FIGHT_STYLE_LABEL[f];
