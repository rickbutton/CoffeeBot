import type { Page } from "playwright";
import { log } from "../util/log.js";
import type { ContentMode, QELiveSpec, RaidDifficulty, UpgradeFinderSettings } from "./settings.js";

// All UI mutations needed to configure a single Upgrade Finder run, in the order
// they should run. The page must already be on /live/ (for spec selection) before
// the import; difficulty toggling must happen on /live/upgradefinder.

export async function selectSpec(page: Page, spec: QELiveSpec): Promise<void> {
    const trigger = page.locator('[aria-labelledby="class-select-label"]').first();
    await trigger.waitFor({ state: "visible", timeout: 10_000 });
    await trigger.click();

    const option = page
        .locator('[role="listbox"][aria-labelledby="class-select-label"] [role="option"]')
        .filter({ hasText: new RegExp(`^${escapeRegex(spec)}$`) })
        .first();
    try {
        await option.waitFor({ state: "visible", timeout: 5_000 });
        await option.click();
        log.info({ spec }, "qelive: selected spec");
    } catch (err) {
        throw new Error(`qelive: spec "${spec}" not found in dropdown`, { cause: err });
    }
}

export async function setContentMode(page: Page, mode: ContentMode): Promise<void> {
    const ariaLabel = mode === "Raid" ? "raidLabel" : "dungeonLabel";
    const button = page.locator(`button[aria-label="${ariaLabel}"]`).first();
    if (!(await button.isVisible().catch(() => false))) return;
    const pressed = (await button.getAttribute("aria-pressed").catch(() => null)) === "true";
    if (pressed) return;
    try {
        await button.click();
        log.info({ mode }, "qelive: set content mode");
    } catch (err) {
        log.warn({ err, mode }, "qelive: could not set content mode");
    }
}

const ALL_DIFFICULTIES: RaidDifficulty[] = [
    "LFR",
    "LFR (Max)",
    "Normal",
    "Normal (Max)",
    "Heroic",
    "Heroic (Max)",
    "Mythic",
    "Mythic (Max)",
];

export async function applyRaidDifficulties(
    page: Page,
    desired: RaidDifficulty[],
): Promise<void> {
    if (desired.length === 0) {
        throw new Error("qelive: at least one raid difficulty must be selected");
    }
    if (desired.length > 2) {
        throw new Error("qelive: at most two raid difficulties can be selected at once");
    }
    const want = new Set(desired);
    for (const label of ALL_DIFFICULTIES) {
        const button = difficultyButton(page, label);
        if (!(await button.isVisible().catch(() => false))) continue;
        const pressed = (await button.getAttribute("aria-pressed").catch(() => null)) === "true";
        const shouldBe = want.has(label);
        if (pressed === shouldBe) continue;
        try {
            await button.click();
            log.info({ label, shouldBe }, "qelive: toggled raid difficulty");
        } catch (err) {
            log.warn({ err, label }, "qelive: could not toggle raid difficulty");
        }
    }
}

// Difficulty buttons all share the same shape; we anchor on the exact label so
// "Mythic" doesn't also match "Mythic (Max)".
function difficultyButton(page: Page, label: RaidDifficulty) {
    return page
        .locator("button")
        .filter({ hasText: new RegExp(`^${escapeRegex(label)}$`) })
        .first();
}

export async function applyUpgradeFinderSettings(
    page: Page,
    s: UpgradeFinderSettings,
): Promise<void> {
    await setContentMode(page, s.contentMode);
    if (s.contentMode === "Raid") {
        await applyRaidDifficulties(page, s.raidDifficulties);
    }
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
