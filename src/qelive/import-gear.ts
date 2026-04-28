import type { Page } from "playwright";
import { log } from "../util/log.js";

export type ImportGearOptions = {
    upgradeAllToMax: boolean;
    upgradeVaultToMax: boolean;
    /** Pause between paste and the next interaction so QELive's React state settles. */
    postPasteSettleMs: number;
};

// Opens the "Import Gear" dialog from the page header, pastes the simc, sets the
// two upgrade-to-max checkboxes, and clicks Submit. Resolves once the dialog has
// closed.
export async function importGear(
    page: Page,
    simc: string,
    opts: ImportGearOptions,
): Promise<void> {
    const importBtn = page.locator('button:has-text("Import Gear")').first();
    await importBtn.waitFor({ state: "visible", timeout: 10_000 });
    await importBtn.click();

    const dialog = page.locator('[role="dialog"]').filter({ hasText: "Paste Your SimC String" });
    await dialog.waitFor({ state: "visible", timeout: 10_000 });

    log.info("qelive: pasting simc");
    const textarea = dialog.locator("#simcentry");
    await textarea.waitFor({ state: "visible", timeout: 10_000 });
    await textarea.fill(simc.replace(/\r\n?/g, "\n"));
    if (opts.postPasteSettleMs > 0) await page.waitForTimeout(opts.postPasteSettleMs);

    await setUpgradeCheckbox(page, "Upgrade ALL to Max Level", opts.upgradeAllToMax);
    await setUpgradeCheckbox(page, "Upgrade Vault to Max Level", opts.upgradeVaultToMax);

    log.info("qelive: submitting gear import");
    const submit = dialog.locator("button").filter({ hasText: /^Submit$/ }).first();
    await submit.waitFor({ state: "visible", timeout: 5_000 });
    await submit.click();
    await dialog.waitFor({ state: "hidden", timeout: 10_000 });
}

// The checkbox is wrapped in a MUI <label>; clicking the label toggles state.
// We branch on current state so a no-op stays a no-op.
async function setUpgradeCheckbox(page: Page, labelText: string, want: boolean): Promise<void> {
    const dialog = page.locator('[role="dialog"]');
    const label = dialog.locator("label").filter({ hasText: labelText }).first();
    const input = label.locator('input[type="checkbox"]').first();
    const isChecked = await input.isChecked().catch(() => false);
    if (isChecked === want) return;
    try {
        await label.click();
        log.info({ labelText, want }, "qelive: toggled upgrade checkbox");
    } catch (err) {
        log.warn({ err, labelText }, "qelive: could not toggle upgrade checkbox");
    }
}
