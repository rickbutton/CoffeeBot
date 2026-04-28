import type { Page } from "playwright";
import { log } from "../util/log.js";
import { difficultyLabel, fightStyleLabel, type SimSettings } from "./settings.js";

export async function applySettings(page: Page, s: SimSettings): Promise<void> {
    await selectSource(page, s.source);
    // Difficulty must precede upgrade-items-up-to — that dropdown's options are difficulty-scoped.
    await selectDifficulty(page, s.difficulty);
    await selectFightStyle(page, s.fightStyle);
    await selectMaxUpgradeIlvl(page);
    await checkUpgradeAllEquipped(page);
}

async function selectSource(page: Page, source: string): Promise<void> {
    const label = page.locator(`p.Text:text-is("${source}")`).first();
    try {
        await label.waitFor({ state: "visible", timeout: 10_000 });
        await label.click();
        log.info({ source }, "raidbots: selected source");
    } catch (err) {
        log.error({ err, source }, "raidbots: source not found");
        throw new Error(`source "${source}" not found in droptimizer Sources list`, { cause: err });
    }
}

async function selectDifficulty(page: Page, difficulty: SimSettings["difficulty"]): Promise<void> {
    const label = difficultyLabel(difficulty);
    const box = page
        .locator("div.Box")
        .filter({ has: page.locator(`p.Text:text-is("${label}")`) })
        .first();
    try {
        await box.waitFor({ state: "visible", timeout: 10_000 });
        await box.click();
        log.info({ difficulty }, "raidbots: selected difficulty");
    } catch (err) {
        log.error({ err, difficulty }, "raidbots: difficulty box not found");
        throw new Error(`difficulty "${label}" not visible after picking source`, { cause: err });
    }
}

async function selectFightStyle(page: Page, style: SimSettings["fightStyle"]): Promise<void> {
    try {
        await page.locator("select#AdvancedSimOptions-fightStyle").selectOption({
            label: fightStyleLabel(style),
        });
        log.info({ style }, "raidbots: selected fight style");
    } catch (err) {
        log.warn({ err, style }, "raidbots: fight style select failed; skipping");
    }
}

async function selectMaxUpgradeIlvl(page: Page): Promise<void> {
    const trigger = page.locator("#react-select-7-input");
    if (!(await trigger.isVisible().catch(() => false))) return;
    try {
        await trigger.click();
        const maxOption = page
            .locator('[id^="react-select-7-option"]')
            .filter({ hasText: "6/6" })
            .first();
        await maxOption.waitFor({ state: "visible", timeout: 5_000 });
        await maxOption.click();
        log.info("raidbots: picked max upgrade ilvl (X 6/6)");
    } catch (err) {
        log.warn({ err }, "raidbots: could not pick max upgrade ilvl");
    }
}

// The real <input> is opacity:0; a sibling div intercepts clicks. Click the wrapping label instead.
async function checkUpgradeAllEquipped(page: Page): Promise<void> {
    const label = page
        .locator("label")
        .filter({ hasText: /upgrade all equipped gear/i })
        .first();
    if (!(await label.isVisible().catch(() => false))) return;
    const input = page.locator('input[name="upgradeEquipped"]').first();
    if (await input.isChecked().catch(() => false)) return;
    try {
        await label.click();
        log.info("raidbots: enabled upgrade-all-equipped");
    } catch (err) {
        log.warn({ err }, "raidbots: could not enable upgrade-all-equipped");
    }
}
