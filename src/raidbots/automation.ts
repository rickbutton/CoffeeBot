import type { Page } from "playwright";
import { log } from "../util/log.js";
import { applySettings } from "./apply-settings.js";
import { ensureLoggedIn, type LoginCredentials } from "./login.js";
import { SIM_SETTINGS, type SimSettings } from "./settings.js";
import type { RaidbotsSession } from "./session.js";

const DROPTIMIZER_URL = "https://www.raidbots.com/simbot/droptimizer";
const REPORT_URL_RE = /\/simbot\/report\/([a-zA-Z0-9_-]+)/;

export type RaidbotsRunResult =
    | { ok: true; reportUrl: string; reportId: string; completed: boolean }
    | { ok: true; submitted: false }
    | { ok: false; error: string };

export type RaidbotsRunOptions = {
    totalTimeoutMs: number;
    waitForCompletion: boolean;
    credentials: LoginCredentials | null;
    settings: SimSettings;
    postPasteSettleMs: number;
    /** If false, leaves the page open after settings — caller closes the session. */
    submitRun: boolean;
};

const DEFAULTS: RaidbotsRunOptions = {
    totalTimeoutMs: 20 * 60 * 1000,
    waitForCompletion: true,
    credentials: null,
    settings: SIM_SETTINGS,
    postPasteSettleMs: 2_500,
    submitRun: true,
};

export async function runDroptimizer(
    session: RaidbotsSession,
    simc: string,
    opts: Partial<RaidbotsRunOptions> = {},
): Promise<RaidbotsRunResult> {
    const o = { ...DEFAULTS, ...opts };
    const start = Date.now();
    const ctx = await session.getContext();
    const page = await ctx.newPage();

    try {
        log.info({ url: DROPTIMIZER_URL }, "raidbots: navigating");
        await page.goto(DROPTIMIZER_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });

        const blocked = await detectBlockingPage(page);
        if (blocked) return { ok: false, error: blocked };

        const loginResult = await ensureLoggedIn(page, o.credentials);
        if (loginResult === "no-credentials") {
            return {
                ok: false,
                error: "raidbots session expired and RAIDBOTS_EMAIL/RAIDBOTS_PASSWORD are not configured",
            };
        }
        if (loginResult === "failed") return { ok: false, error: "raidbots auto-login failed" };
        if (!page.url().includes("/simbot/droptimizer")) {
            await page.goto(DROPTIMIZER_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
        }

        log.info("raidbots: pasting simc");
        const editor = page.locator(".cm-content");
        await editor.waitFor({ state: "visible", timeout: 10_000 });
        // The CodeMirror editor doubles \r\n into two newlines.
        await editor.fill(simc.replace(/\r\n?/g, "\n"));
        await page.waitForTimeout(o.postPasteSettleMs);

        log.info({ settings: o.settings }, "raidbots: applying settings");
        await applySettings(page, o.settings);

        if (!o.submitRun) {
            log.info("raidbots: submitRun=false — leaving page open for caller");
            return { ok: true, submitted: false };
        }

        log.info("raidbots: clicking Run Droptimizer");
        const submit = page.getByRole("button", { name: /run droptimizer/i }).first();
        await submit.waitFor({ state: "visible", timeout: 10_000 });
        await submit.click();

        log.info("raidbots: waiting for report URL");
        await page.waitForURL(REPORT_URL_RE, { timeout: 60_000, waitUntil: "domcontentloaded" });
        const reportUrl = page.url();
        const reportId = REPORT_URL_RE.exec(reportUrl)?.[1];
        if (!reportId)
            return {
                ok: false,
                error: `submitted but URL didn't match report pattern: ${reportUrl}`,
            };
        log.info({ reportUrl, reportId }, "raidbots: report URL captured");

        if (!o.waitForCompletion) return { ok: true, reportUrl, reportId, completed: false };

        const remainingMs = Math.max(o.totalTimeoutMs - (Date.now() - start), 30_000);
        const completed = await waitForCompletion(page, remainingMs);
        if (!completed) {
            return {
                ok: false,
                error: `sim did not complete within ${Math.round(o.totalTimeoutMs / 1000)}s`,
            };
        }
        return { ok: true, reportUrl, reportId, completed: true };
    } catch (err) {
        log.error({ err }, "raidbots: unexpected error");
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
        if (o.submitRun) await page.close().catch(() => {});
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
    if (body.includes("queue is full") || body.includes("sim queue full"))
        return "raidbots reports the sim queue is full";
    if (body.includes("rate limit") || body.includes("too many requests"))
        return "raidbots is rate-limiting us";
    return null;
}

async function waitForCompletion(page: Page, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    let lastTitle = "";
    while (Date.now() < deadline) {
        const title = (await page.title().catch(() => "")) ?? "";
        if (title !== lastTitle) {
            log.info({ title }, "raidbots: report page title");
            lastTitle = title;
        }
        if (/error|failed/i.test(title)) return false;
        if (isCompletedTitle(title)) return true;
        await page.waitForTimeout(5_000);
    }
    return false;
}

// Done title contains character + DPS/HPS; in-progress titles start with a known placeholder.
function isCompletedTitle(title: string): boolean {
    if (!title) return false;
    if (/^(simulating|queued|loading|preparing|pending|running)\b/i.test(title)) return false;
    if (title === "Droptimizer - Raidbots" || title === "Raidbots") return false;
    if (/\b(dps|hps|tps|dtps)\b/i.test(title)) return true;
    return title.length > 30 && /[•·-]/.test(title);
}
