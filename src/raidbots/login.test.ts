import { describe, expect, it, vi } from "vitest";
import { ensureLoggedIn, isLoggedOut } from "./login.js";

describe("isLoggedOut", () => {
    it("is true on /auth", () => {
        expect(isLoggedOut({ url: () => "https://www.raidbots.com/auth" } as never)).toBe(true);
        expect(isLoggedOut({ url: () => "https://www.raidbots.com/auth/" } as never)).toBe(true);
        expect(
            isLoggedOut({ url: () => "https://www.raidbots.com/auth?next=foo" } as never),
        ).toBe(true);
        expect(isLoggedOut({ url: () => "https://www.raidbots.com/login" } as never)).toBe(true);
    });

    it("is false elsewhere", () => {
        expect(
            isLoggedOut({ url: () => "https://www.raidbots.com/simbot/droptimizer" } as never),
        ).toBe(false);
    });
});

describe("ensureLoggedIn", () => {
    it("returns ok if already signed in", async () => {
        const page = { url: () => "https://www.raidbots.com/simbot/droptimizer" } as never;
        const r = await ensureLoggedIn(page, null);
        expect(r).toBe("ok");
    });

    it("returns no-credentials if logged out and no creds provided", async () => {
        const page = { url: () => "https://www.raidbots.com/auth" } as never;
        const r = await ensureLoggedIn(page, null);
        expect(r).toBe("no-credentials");
    });

    it("returns failed when login flow does not redirect away from /auth", async () => {
        // Simulate page methods used by login(): goto, locator(...).waitFor/.fill/.click,
        // waitForURL, waitForTimeout, url().
        const page = {
            url: () => "https://www.raidbots.com/auth",
            goto: vi.fn(async () => undefined),
            waitForURL: vi.fn(async () => undefined),
            waitForTimeout: vi.fn(async () => undefined),
            locator: vi.fn(() => ({
                waitFor: vi.fn(async () => undefined),
                fill: vi.fn(async () => undefined),
                click: vi.fn(async () => undefined),
            })),
        } as never;
        const r = await ensureLoggedIn(page, { email: "e@x", password: "p" });
        expect(r).toBe("failed");
    });

    it("returns ok when login succeeds (page url moves off /auth)", async () => {
        let url = "https://www.raidbots.com/auth";
        const page = {
            url: () => url,
            goto: vi.fn(async () => {
                // No-op; first goto leaves us on /auth.
            }),
            waitForURL: vi.fn(async () => undefined),
            waitForTimeout: vi.fn(async () => {
                // Simulate post-login redirect.
                url = "https://www.raidbots.com/simbot/droptimizer";
            }),
            locator: vi.fn(() => ({
                waitFor: vi.fn(async () => undefined),
                fill: vi.fn(async () => undefined),
                click: vi.fn(async () => undefined),
            })),
        } as never;
        const r = await ensureLoggedIn(page, { email: "e@x", password: "p" });
        expect(r).toBe("ok");
    });

    it("returns failed when the login form never appears", async () => {
        const page = {
            url: () => "https://www.raidbots.com/auth",
            goto: vi.fn(async () => undefined),
            waitForURL: vi.fn(async () => undefined),
            waitForTimeout: vi.fn(async () => undefined),
            locator: vi.fn(() => ({
                waitFor: vi.fn(async () => Promise.reject(new Error("timeout"))),
                fill: vi.fn(async () => undefined),
                click: vi.fn(async () => undefined),
            })),
        } as never;
        const r = await ensureLoggedIn(page, { email: "e@x", password: "p" });
        expect(r).toBe("failed");
    });
});
