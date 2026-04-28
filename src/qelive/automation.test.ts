import { describe, expect, it, vi } from "vitest";
import { runUpgradeFinder } from "./automation.js";
import type { UpgradeFinderSettings } from "./settings.js";

// We mock import-gear and apply-settings so this test focuses on automation's
// orchestration: navigation, welcome-dialog handling, Go!, URL capture.
vi.mock("./import-gear.js", () => ({
    importGear: vi.fn(async () => {}),
}));
vi.mock("./apply-settings.js", () => ({
    selectSpec: vi.fn(async () => {}),
    applyUpgradeFinderSettings: vi.fn(async () => {}),
}));

type LocatorState = {
    visible?: boolean;
    waitFails?: boolean;
    bodyText?: string;
};

function makeLocator(state: LocatorState = {}) {
    return {
        first: () => makeLocator(state),
        filter: () => makeLocator(state),
        locator: () => makeLocator(state),
        waitFor: vi.fn(async () => {
            if (state.waitFails) throw new Error("not found");
        }),
        click: vi.fn(async () => {}),
        isVisible: vi.fn(async () => state.visible ?? true),
        innerText: vi.fn(async () => state.bodyText ?? ""),
    };
}

function makePage(opts: {
    bodyText?: string;
    welcomeVisible?: boolean;
    initialUrl?: string;
    afterGoUrl?: string;
    waitForUrlThrows?: boolean;
    locatorThrows?: boolean;
} = {}) {
    let currentUrl = opts.initialUrl ?? "https://questionablyepic.com/live/";
    return {
        url: () => currentUrl,
        goto: vi.fn(async (u: string) => {
            currentUrl = u;
        }),
        waitForURL: vi.fn(async () => {
            if (opts.waitForUrlThrows) throw new Error("timeout");
            currentUrl =
                opts.afterGoUrl ?? "https://questionablyepic.com/live/upgradereport/abc123";
        }),
        close: vi.fn(async () => {}),
        locator: vi.fn((sel: string) => {
            if (opts.locatorThrows) throw new Error("locator boom");
            if (sel === "body")
                return makeLocator({ bodyText: opts.bodyText ?? "" });
            // The "Begin!" dismiss path uses a button-with-text filter; toggle visibility.
            return makeLocator({ visible: opts.welcomeVisible !== false });
        }),
    };
}

function makeSession(page: ReturnType<typeof makePage>) {
    return {
        getContext: async () => ({ newPage: async () => page }),
    } as never;
}

const SETTINGS: UpgradeFinderSettings = {
    spec: "Restoration Shaman",
    contentMode: "Raid",
    raidDifficulties: ["Mythic (Max)"],
    upgradeAllToMax: true,
    upgradeVaultToMax: true,
};

describe("runUpgradeFinder", () => {
    it("captures the report URL on the happy path", async () => {
        const page = makePage({ welcomeVisible: false });
        const r = await runUpgradeFinder(makeSession(page), 'shaman="x"\n', { settings: SETTINGS });
        if (!r.ok) throw new Error("expected ok");
        if ("submitted" in r) throw new Error("expected report URL, got submitted");
        expect(r.reportId).toBe("abc123");
        expect(r.reportUrl).toContain("abc123");
    });

    it("dismisses the welcome dialog when present", async () => {
        const page = makePage({ welcomeVisible: true });
        const r = await runUpgradeFinder(makeSession(page), "x", { settings: SETTINGS });
        expect(r.ok).toBe(true);
    });

    it("returns submitted:false when submitRun=false", async () => {
        const page = makePage({ welcomeVisible: false });
        const r = await runUpgradeFinder(makeSession(page), "x", {
            settings: SETTINGS,
            submitRun: false,
        });
        expect(r).toEqual({ ok: true, submitted: false });
    });

    it("detects cloudflare/anti-bot", async () => {
        const page = makePage({ bodyText: "verify you are human" });
        const r = await runUpgradeFinder(makeSession(page), "x", { settings: SETTINGS });
        if (r.ok) throw new Error("expected fail");
        expect(r.error).toMatch(/anti-bot/);
    });

    it("detects rate limiting", async () => {
        const page = makePage({ bodyText: "rate limit exceeded" });
        const r = await runUpgradeFinder(makeSession(page), "x", { settings: SETTINGS });
        if (r.ok) throw new Error("expected fail");
        expect(r.error).toMatch(/rate-limiting/);
    });

    it("returns failure when waitForURL times out", async () => {
        const page = makePage({ welcomeVisible: false, waitForUrlThrows: true });
        const r = await runUpgradeFinder(makeSession(page), "x", { settings: SETTINGS });
        if (r.ok) throw new Error("expected fail");
        expect(r.error).toBeTruthy();
    });

    it("returns failure when the post-Go URL doesn't match the report pattern", async () => {
        const page = makePage({
            welcomeVisible: false,
            afterGoUrl: "https://questionablyepic.com/live/upgradefinder",
        });
        const r = await runUpgradeFinder(makeSession(page), "x", { settings: SETTINGS });
        if (r.ok) throw new Error("expected fail");
        expect(r.error).toMatch(/didn't match report pattern/);
    });

    it("returns failure when an exception bubbles out", async () => {
        const page = makePage({ welcomeVisible: false, locatorThrows: true });
        const r = await runUpgradeFinder(makeSession(page), "x", { settings: SETTINGS });
        if (r.ok) throw new Error("expected fail");
        expect(r.error).toBeTruthy();
    });
});
