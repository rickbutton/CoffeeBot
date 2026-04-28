import { describe, expect, it } from "vitest";
import { DEFAULT_UPGRADE_FINDER_SETTINGS, qeliveSpecFor } from "./settings.js";

describe("qeliveSpecFor", () => {
    it("maps every healer class/spec pair to the QELive label", () => {
        expect(qeliveSpecFor("druid", "restoration")).toBe("Restoration Druid");
        expect(qeliveSpecFor("evoker", "preservation")).toBe("Preservation Evoker");
        expect(qeliveSpecFor("monk", "mistweaver")).toBe("Mistweaver Monk");
        expect(qeliveSpecFor("paladin", "holy")).toBe("Holy Paladin");
        expect(qeliveSpecFor("priest", "discipline")).toBe("Discipline Priest");
        expect(qeliveSpecFor("priest", "holy")).toBe("Holy Priest");
        expect(qeliveSpecFor("shaman", "restoration")).toBe("Restoration Shaman");
    });

    it("returns null for non-healer specs and missing input", () => {
        expect(qeliveSpecFor("hunter", "beast_mastery")).toBeNull();
        expect(qeliveSpecFor("druid", "balance")).toBeNull();
        expect(qeliveSpecFor("shaman", "elemental")).toBeNull();
        expect(qeliveSpecFor("druid", null)).toBeNull();
        expect(qeliveSpecFor("druid", "")).toBeNull();
    });
});

describe("DEFAULT_UPGRADE_FINDER_SETTINGS", () => {
    it("defaults to raid + Mythic (Max) only and both upgrade flags on", () => {
        expect(DEFAULT_UPGRADE_FINDER_SETTINGS).toEqual({
            contentMode: "Raid",
            raidDifficulties: ["Mythic (Max)"],
            upgradeAllToMax: true,
            upgradeVaultToMax: true,
        });
    });
});
