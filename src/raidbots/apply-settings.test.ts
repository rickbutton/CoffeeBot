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
        last: () => makeLocator(state),
        filter: () => makeLocator(state),
        locator: () => makeLocator(state),
        waitFor: vi.fn(async () => {
            if (state.waitFails) throw new Error("not found");
        }),
        click: vi.fn(async () => {}),
        isVisible: vi.fn(async () => state.visible ?? true),
        isChecked: vi.fn(async () => state.checked ?? false),
        selectOption: vi.fn(async () => []),
    };
}

const SIM_OPTIONS_HEADER_XPATH =
    "xpath=//div[contains(@class,'Box') and starts-with(normalize-space(text()),'Simulation Options:')]";
const UPGRADE_TRIGGER_XPATH =
    "xpath=(//*[starts-with(normalize-space(text()),'Upgrade up to:')]/following::div[contains(@class,'-control') and .//input[starts-with(@id,'react-select-')]])[1]";

function makePage(locators: Record<string, LocatorState> = {}) {
    return {
        locator: vi.fn((sel: string) => makeLocator(locators[sel] ?? {})),
    } as never;
}

describe("applySettings", () => {
    it("happy path runs through all setters when fight-style select is already mounted", async () => {
        const page = makePage({
            "select#AdvancedSimOptions-fightStyle": { visible: true },
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

    it("expands Simulation Options when fight-style select isn't initially visible", async () => {
        let panelOpen = false;
        const headerClick = vi.fn(async () => {
            panelOpen = true;
        });
        const page = {
            locator: vi.fn((sel: string) => {
                if (sel === "select#AdvancedSimOptions-fightStyle")
                    return {
                        ...makeLocator(),
                        isVisible: vi.fn(async () => panelOpen),
                        waitFor: vi.fn(async () => {
                            if (!panelOpen) throw new Error("not visible");
                        }),
                        selectOption: vi.fn(async () => []),
                    };
                if (sel === SIM_OPTIONS_HEADER_XPATH)
                    return { ...makeLocator(), click: headerClick };
                return makeLocator();
            }),
        } as never;
        await applySettings(page, SIM_SETTINGS);
        expect(headerClick).toHaveBeenCalledTimes(1);
    });

    it("throws when Simulation Options panel cannot be expanded", async () => {
        const page = {
            locator: vi.fn((sel: string) => {
                if (sel === "select#AdvancedSimOptions-fightStyle")
                    return {
                        ...makeLocator(),
                        isVisible: vi.fn(async () => false),
                        waitFor: vi.fn(async () => Promise.reject(new Error("not visible"))),
                    };
                if (sel === SIM_OPTIONS_HEADER_XPATH)
                    return {
                        ...makeLocator(),
                        click: vi.fn(async () => Promise.reject(new Error("no header"))),
                    };
                return makeLocator();
            }),
        } as never;
        await expect(applySettings(page, SIM_SETTINGS)).rejects.toThrow(
            /Simulation Options panel did not expand/,
        );
    });

    it("throws when fight-style selectOption fails", async () => {
        const page = {
            locator: vi.fn((sel: string) => {
                if (sel === "select#AdvancedSimOptions-fightStyle")
                    return {
                        ...makeLocator({ visible: true }),
                        selectOption: vi.fn(async () => Promise.reject(new Error("nope"))),
                    };
                return makeLocator();
            }),
        } as never;
        await expect(applySettings(page, SIM_SETTINGS)).rejects.toThrow(/fight style/i);
    });

    it("throws when upgrade-ilvl trigger is not visible", async () => {
        const page = {
            locator: vi.fn((sel: string) => {
                if (sel === "select#AdvancedSimOptions-fightStyle")
                    return makeLocator({ visible: true });
                if (sel === UPGRADE_TRIGGER_XPATH) return makeLocator({ waitFails: true });
                return makeLocator();
            }),
        } as never;
        await expect(applySettings(page, SIM_SETTINGS)).rejects.toThrow(/upgrade ilvl/i);
    });

    it("throws when 6/6 option does not appear after clicking the upgrade-ilvl trigger", async () => {
        const page = {
            locator: vi.fn((sel: string) => {
                if (sel === "select#AdvancedSimOptions-fightStyle")
                    return makeLocator({ visible: true });
                if (sel === UPGRADE_TRIGGER_XPATH) return makeLocator({ visible: true });
                if (sel === "[role='option']")
                    return {
                        ...makeLocator(),
                        filter: () => ({
                            first: () => ({
                                ...makeLocator(),
                                waitFor: vi.fn(async () =>
                                    Promise.reject(new Error("no 6/6 option")),
                                ),
                            }),
                        }),
                    };
                return makeLocator();
            }),
        } as never;
        await expect(applySettings(page, SIM_SETTINGS)).rejects.toThrow(/upgrade ilvl/i);
    });

    it("skips upgrade-equipped when already checked", async () => {
        const page = makePage({
            "select#AdvancedSimOptions-fightStyle": { visible: true },
            'input[name="upgradeEquipped"]': { checked: true },
        });
        await applySettings(page, SIM_SETTINGS);
    });

    it("throws when upgrade-equipped label is not visible", async () => {
        const page = makePage({
            "select#AdvancedSimOptions-fightStyle": { visible: true },
            "label": { waitFails: true },
            'input[name="upgradeEquipped"]': { checked: false },
        });
        await expect(applySettings(page, SIM_SETTINGS)).rejects.toThrow(/upgrade-all-equipped/i);
    });

    it("throws when upgrade-equipped label click fails", async () => {
        const page = {
            locator: vi.fn((sel: string) => {
                if (sel === "select#AdvancedSimOptions-fightStyle")
                    return makeLocator({ visible: true });
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
