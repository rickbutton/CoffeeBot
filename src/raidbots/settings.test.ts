import { describe, expect, it } from "vitest";
import { difficultyLabel, fightStyleLabel, SIM_SETTINGS } from "./settings.js";

describe("settings labels", () => {
    it("maps every difficulty to a human label", () => {
        expect(difficultyLabel("lfr")).toBe("Raid Finder");
        expect(difficultyLabel("normal")).toBe("Normal");
        expect(difficultyLabel("heroic")).toBe("Heroic");
        expect(difficultyLabel("mythic")).toBe("Mythic");
    });

    it("maps every fight style to a human label", () => {
        expect(fightStyleLabel("patchwerk")).toBe("Patchwerk");
        expect(fightStyleLabel("dungeon_slice")).toBe("Dungeon Slice");
        expect(fightStyleLabel("target_dummy")).toBe("Target Dummy");
        expect(fightStyleLabel("execute_patchwerk")).toBe("Execute Patchwerk");
        expect(fightStyleLabel("hectic_add_cleave")).toBe("Hectic Add Cleave");
        expect(fightStyleLabel("light_movement")).toBe("Light Movement");
        expect(fightStyleLabel("heavy_movement")).toBe("Heavy Movement");
        expect(fightStyleLabel("casting_patchwerk")).toBe("Casting Patchwerk");
        expect(fightStyleLabel("cleave_add")).toBe("Cleave Add");
    });

    it("ships a default SIM_SETTINGS", () => {
        expect(SIM_SETTINGS.source).toBeTruthy();
        expect(SIM_SETTINGS.difficulty).toBeTruthy();
        expect(SIM_SETTINGS.fightStyle).toBeTruthy();
    });
});
