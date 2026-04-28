import type { Page } from "playwright";
import { log } from "../util/log.js";
import { difficultyLabel, fightStyleLabel, type SimSettings } from "./settings.js";

export async function applySettings(page: Page, s: SimSettings): Promise<void> {
    await selectSource(page, s.source);
    // Difficulty must precede ensureSimulationOptionsOpen / selectMaxUpgradeIlvl: picking a
    // difficulty is what mounts the "Upgrade up to:" react-select inside ITEMS TO SIM. The
    // difficulty tabs themselves live in the always-visible RAID DIFFICULTY section, not in
    // the Simulation Options panel.
    await selectDifficulty(page, s.difficulty);
    // Simulation Options panel must be open before fight-style: that <select> only mounts when
    // the panel is expanded (Raidbots persists open/closed in localStorage per profile, so a
    // fresh profile defaults to collapsed).
    await ensureSimulationOptionsOpen(page);
    await selectFightStyle(page, s.fightStyle);
    await selectMaxUpgradeIlvl(page);
    await checkUpgradeAllEquipped(page);
}

async function ensureSimulationOptionsOpen(page: Page): Promise<void> {
    const select = page.locator("select#AdvancedSimOptions-fightStyle");
    if (await select.isVisible({ timeout: 500 }).catch(() => false)) return;
    // The clickable title is a leaf <div class="Box"> whose own (direct) text is
    // "Simulation Options:" — when the panel is collapsed, its full textContent is the entire
    // summary line ("Simulation Options: Smart Sim, Patchwerk, ..."), so we have to filter on
    // the element's direct text node, which only XPath's text() exposes. Click is a toggle —
    // safe because we early-return above if the select is already mounted.
    const header = page.locator(
        "xpath=//div[contains(@class,'Box') and starts-with(normalize-space(text()),'Simulation Options:')]",
    );
    try {
        await header.click({ timeout: 5_000 });
        await select.waitFor({ state: "visible", timeout: 10_000 });
        log.info("raidbots: expanded Simulation Options panel");
    } catch (err) {
        log.error({ err }, "raidbots: could not expand Simulation Options panel");
        throw new Error("Simulation Options panel did not expand", { cause: err });
    }
}

// Source/difficulty run before the page has fully hydrated React + fetched the source list.
// On a cold-start Fly machine (shared-cpu-1x), that hydration can take 15-20s on top of
// page.goto's "domcontentloaded" return. 30s gives slow VMs enough headroom while still
// failing fast if the page is genuinely broken.
const COLD_START_TIMEOUT_MS = 30_000;

async function selectSource(page: Page, source: string): Promise<void> {
    const label = page.locator(`p.Text:text-is("${source}")`).first();
    try {
        await label.waitFor({ state: "visible", timeout: COLD_START_TIMEOUT_MS });
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
        await box.waitFor({ state: "visible", timeout: COLD_START_TIMEOUT_MS });
        await box.click();
        log.info({ difficulty }, "raidbots: selected difficulty");
    } catch (err) {
        log.error({ err, difficulty }, "raidbots: difficulty box not found");
        throw new Error(`difficulty "${label}" not visible after picking source`, { cause: err });
    }
}

async function selectFightStyle(page: Page, style: SimSettings["fightStyle"]): Promise<void> {
    const label = fightStyleLabel(style);
    try {
        await page.locator("select#AdvancedSimOptions-fightStyle").selectOption({ label });
        log.info({ style }, "raidbots: selected fight style");
    } catch (err) {
        log.error({ err, style }, "raidbots: fight style select failed");
        throw new Error(`could not select fight style "${label}"`, { cause: err });
    }
}

async function selectMaxUpgradeIlvl(page: Page): Promise<void> {
    // The react-select index is auto-numbered and shifts with which other selects are mounted
    // (regions, realms, etc.), so we anchor on the "Upgrade up to:" label text and walk forward
    // to the first react-select control wrapper. We target the control wrapper (div with class
    // containing "-control") rather than the inner <input>, because the input has opacity:0 and
    // pointer events on its bounding box are intercepted by the overlaid singleValue text and
    // the page's fixed Raidbots logo. Options match the "X 6/6" text rather than a numbered id.
    const trigger = page.locator(
        "xpath=(//*[starts-with(normalize-space(text()),'Upgrade up to:')]/following::div[contains(@class,'-control') and .//input[starts-with(@id,'react-select-')]])[1]",
    );
    try {
        await trigger.waitFor({ state: "visible", timeout: 10_000 });
        await trigger.click();
        // Options look like "289Myth 6/6", "285Myth 5/6", etc. — only the max-track-max-rank
        // option ends in "6/6" preceded by a non-digit, so this matches uniquely.
        const maxOption = page
            .locator("[role='option']")
            .filter({ hasText: /\b6\s*\/\s*6\b/ })
            .first();
        await maxOption.waitFor({ state: "visible", timeout: 5_000 });
        await maxOption.click();
        log.info("raidbots: picked max upgrade ilvl (6/6)");
    } catch (err) {
        log.error({ err }, "raidbots: could not pick max upgrade ilvl");
        throw new Error("could not select max upgrade ilvl (6/6)", { cause: err });
    }
}

// The real <input> is opacity:0; a sibling div intercepts clicks. Click the wrapping label instead.
async function checkUpgradeAllEquipped(page: Page): Promise<void> {
    const input = page.locator('input[name="upgradeEquipped"]').first();
    if (await input.isChecked().catch(() => false)) return;
    const label = page
        .locator("label")
        .filter({ hasText: /upgrade all equipped gear/i })
        .first();
    try {
        await label.waitFor({ state: "visible", timeout: 10_000 });
        await label.click();
        log.info("raidbots: enabled upgrade-all-equipped");
    } catch (err) {
        log.error({ err }, "raidbots: could not enable upgrade-all-equipped");
        throw new Error("could not enable upgrade-all-equipped", { cause: err });
    }
}
