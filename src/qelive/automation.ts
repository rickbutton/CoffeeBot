import type { Page } from "playwright";
import { log } from "../util/log.js";
import { applyUpgradeFinderSettings, selectSpec } from "./apply-settings.js";
import { importGear } from "./import-gear.js";
import type { UpgradeFinderSettings } from "./settings.js";
import type { QELiveSession } from "./session.js";

const HOME_URL = "https://questionablyepic.com/live/";
const UPGRADE_FINDER_URL = "https://questionablyepic.com/live/upgradefinder";
const REPORT_URL_RE = /\/live\/upgradereport\/([a-zA-Z0-9_-]+)/;

export type QELiveRunResult =
    | { ok: true; reportUrl: string; reportId: string }
    | { ok: true; submitted: false }
    | { ok: false; error: string };

export type QELiveRunOptions = {
    settings: UpgradeFinderSettings;
    /** If false, leaves the page open after settings — caller closes the session. */
    submitRun: boolean;
    /** Total budget for the whole run, including navigation + Go!. */
    totalTimeoutMs: number;
    /** Pause between simc paste and the next interaction so React state settles. */
    postPasteSettleMs: number;
};

export async function runUpgradeFinder(
    session: QELiveSession,
    simc: string,
    opts: Partial<QELiveRunOptions> & { settings: UpgradeFinderSettings },
): Promise<QELiveRunResult> {
    const o: QELiveRunOptions = {
        submitRun: true,
        totalTimeoutMs: 5 * 60 * 1000,
        postPasteSettleMs: 2_500,
        ...opts,
    };
    const ctx = await session.getContext();
    const page = await ctx.newPage();

    try {
        log.info({ url: HOME_URL, spec: o.settings.spec }, "qelive: navigating");
        await page.goto(HOME_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });

        const blocked = await detectBlockingPage(page);
        if (blocked) return { ok: false, error: blocked };

        await dismissWelcomeDialog(page);

        await selectSpec(page, o.settings.spec);

        log.info({ url: UPGRADE_FINDER_URL }, "qelive: opening upgrade finder");
        await page.goto(UPGRADE_FINDER_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });

        await importGear(page, simc, {
            upgradeAllToMax: o.settings.upgradeAllToMax,
            upgradeVaultToMax: o.settings.upgradeVaultToMax,
            postPasteSettleMs: o.postPasteSettleMs,
        });

        log.info({ settings: o.settings }, "qelive: applying upgrade-finder settings");
        await applyUpgradeFinderSettings(page, o.settings);

        if (!o.submitRun) {
            log.info("qelive: submitRun=false — leaving page open for caller");
            return { ok: true, submitted: false };
        }

        log.info("qelive: clicking Go!");
        const go = page.locator("button").filter({ hasText: /^Go!$/ }).first();
        await go.waitFor({ state: "visible", timeout: 10_000 });
        await go.click();

        log.info("qelive: waiting for report URL");
        await page.waitForURL(REPORT_URL_RE, {
            timeout: Math.min(o.totalTimeoutMs, 60_000),
            waitUntil: "domcontentloaded",
        });
        const reportUrl = page.url();
        const reportId = REPORT_URL_RE.exec(reportUrl)?.[1];
        if (!reportId) {
            return {
                ok: false,
                error: `submitted but URL didn't match report pattern: ${reportUrl}`,
            };
        }
        log.info({ reportUrl, reportId }, "qelive: report URL captured");
        return { ok: true, reportUrl, reportId };
    } catch (err) {
        log.error({ err }, "qelive: unexpected error");
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
        if (o.submitRun) await page.close().catch(() => {});
    }
}

// Welcome dialog only shows on the very first visit (state lives in localStorage).
// Persistent sessions skip it; we still handle the case for fresh profiles.
async function dismissWelcomeDialog(page: Page): Promise<void> {
    const begin = page.locator("button").filter({ hasText: /^Begin!$/ }).first();
    if (!(await begin.isVisible().catch(() => false))) return;
    log.info("qelive: dismissing welcome dialog");
    try {
        await begin.click();
        await begin.waitFor({ state: "hidden", timeout: 5_000 });
    } catch (err) {
        log.warn({ err }, "qelive: failed to dismiss welcome dialog");
    }
}

async function detectBlockingPage(page: Page): Promise<string | null> {
    const body = (
        (await page
            .locator("body")
            .innerText()
            .catch(() => "")) ?? ""
    ).toLowerCase();
    if (body.includes("verify you are human") || body.includes("cloudflare"))
        return "blocked by anti-bot challenge";
    if (body.includes("rate limit") || body.includes("too many requests"))
        return "qelive is rate-limiting us";
    return null;
}
