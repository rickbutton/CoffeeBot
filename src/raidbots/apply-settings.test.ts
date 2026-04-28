import { describe, expect, it, vi } from "vitest";
import { applySettings } from "./apply-settings.js";
import { SIM_SETTINGS } from "./settings.js";

type LocatorState = {
    visible?: boolean;
    checked?: boolean;
    waitFails?: boolean;
};

function makeLocator(state: LocatorState = {}) {
    return {
        first: () => makeLocator(state),
        filter: () => makeLocator(state),
        waitFor: vi.fn(async () => {
            if (state.waitFails) throw new Error("not found");
        }),
        click: vi.fn(async () => {}),
        isVisible: vi.fn(async () => state.visible ?? true),
        isChecked: vi.fn(async () => state.checked ?? false),
        selectOption: vi.fn(async () => []),
    };
}

function makePage(locators: Record<string, LocatorState> = {}) {
    return {
        locator: vi.fn((sel: string) => makeLocator(locators[sel] ?? {})),
    } as never;
}

describe("applySettings", () => {
    it("happy path runs through all setters", async () => {
        const page = makePage({
            "#react-select-7-input": { visible: true },
            'input[name="upgradeEquipped"]': { checked: false },
        });
        await applySettings(page, SIM_SETTINGS);
        // No throw is success.
    });

    it("throws when source label is not found", async () => {
        const page = makePage({
            'p.Text:text-is("Season 1 Raids")': { waitFails: true },
        });
        await expect(applySettings(page, SIM_SETTINGS)).rejects.toThrow(/source/);
    });

    it("throws when difficulty box is not found after source picks", async () => {
        const page = makePage({
            "div.Box": { waitFails: true },
        });
        await expect(applySettings(page, SIM_SETTINGS)).rejects.toThrow(/difficulty/i);
    });

    it("warns and skips fight style when select fails", async () => {
        // Make selectOption throw; should not bubble.
        const page = {
            locator: vi.fn((sel: string) => {
                if (sel === "select#AdvancedSimOptions-fightStyle") {
                    return {
                        ...makeLocator(),
                        selectOption: vi.fn(async () => Promise.reject(new Error("nope"))),
                    };
                }
                return makeLocator({ visible: false });
            }),
        } as never;
        await applySettings(page, SIM_SETTINGS);
    });

    it("throws when upgrade-ilvl picker is not visible", async () => {
        const page = makePage({
            "#react-select-7-input": { waitFails: true },
        });
        await expect(applySettings(page, SIM_SETTINGS)).rejects.toThrow(/upgrade ilvl/i);
    });

    it("skips upgrade-equipped when already checked", async () => {
        const page = makePage({
            'input[name="upgradeEquipped"]': { checked: true },
        });
        await applySettings(page, SIM_SETTINGS);
    });

    it("throws when upgrade-equipped label is not visible", async () => {
        const page = makePage({
            "label": { waitFails: true },
            'input[name="upgradeEquipped"]': { checked: false },
        });
        await expect(applySettings(page, SIM_SETTINGS)).rejects.toThrow(/upgrade-all-equipped/i);
    });

    it("throws when upgrade-ilvl click path fails", async () => {
        let count = 0;
        const page = {
            locator: vi.fn((sel: string) => {
                count++;
                if (sel === "#react-select-7-input") return makeLocator({ visible: true });
                if (sel === '[id^="react-select-7-option"]')
                    return {
                        ...makeLocator(),
                        first: () => ({
                            ...makeLocator(),
                            waitFor: vi.fn(async () => Promise.reject(new Error("none"))),
                        }),
                        filter: () => ({
                            first: () => ({
                                ...makeLocator(),
                                waitFor: vi.fn(async () => Promise.reject(new Error("none"))),
                            }),
                        }),
                    };
                return makeLocator();
            }),
        } as never;
        await expect(applySettings(page, SIM_SETTINGS)).rejects.toThrow(/upgrade ilvl/i);
        expect(count).toBeGreaterThan(0);
    });

    it("throws when upgrade-equipped label click fails", async () => {
        const page = {
            locator: vi.fn((sel: string) => {
                if (sel === "label") {
                    return {
                        ...makeLocator(),
                        filter: () => ({
                            first: () => ({
                                ...makeLocator({ visible: true }),
                                click: vi.fn(async () => Promise.reject(new Error("nope"))),
                            }),
                        }),
                    };
                }
                if (sel === 'input[name="upgradeEquipped"]') {
                    return {
                        ...makeLocator({ checked: false }),
                        first: () => makeLocator({ checked: false }),
                    };
                }
                return makeLocator();
            }),
        } as never;
        await expect(applySettings(page, SIM_SETTINGS)).rejects.toThrow(/upgrade-all-equipped/i);
    });
});
