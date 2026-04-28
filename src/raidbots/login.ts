import type { Page } from "playwright";
import { log } from "../util/log.js";

export type LoginCredentials = { email: string; password: string };

const LOGIN_URL = "https://www.raidbots.com/auth";
const AUTH_PATH_RE = /\/auth(\/|$|\?)|\/login(\/|$|\?)/i;

export function isLoggedOut(page: Page): boolean {
    return AUTH_PATH_RE.test(page.url());
}

export async function login(page: Page, creds: LoginCredentials): Promise<boolean> {
    log.info("raidbots: attempting login");
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });

    const email = page.locator("#loginEmail");
    try {
        await email.waitFor({ state: "visible", timeout: 10_000 });
    } catch {
        log.error("raidbots: login form did not appear");
        return false;
    }

    await email.fill(creds.email);
    await page.locator("#loginPassword").fill(creds.password);
    await Promise.all([
        page
            .waitForURL((u) => !AUTH_PATH_RE.test(u.toString()), { timeout: 30_000 })
            .catch(() => {}),
        page.locator("#loginSubmit").click(),
    ]);

    await page.waitForTimeout(1_000);
    if (!isLoggedOut(page)) {
        log.info("raidbots: login succeeded");
        return true;
    }
    log.error({ url: page.url() }, "raidbots: login did not redirect away from /auth");
    return false;
}

export async function ensureLoggedIn(
    page: Page,
    creds: LoginCredentials | null,
): Promise<"ok" | "no-credentials" | "failed"> {
    if (!isLoggedOut(page)) return "ok";
    if (!creds) return "no-credentials";
    return (await login(page, creds)) ? "ok" : "failed";
}
