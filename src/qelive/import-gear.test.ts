import { describe, expect, it, vi } from "vitest";
import { importGear } from "./import-gear.js";

type LocatorState = {
    visible?: boolean;
    checked?: boolean;
    waitFails?: boolean;
    clickThrows?: boolean;
};

function makeLocator(
    state: LocatorState,
    states: Record<string, LocatorState>,
    fillRecord?: string[],
) {
    return {
        first: () => makeLocator(state, states, fillRecord),
        filter: () => makeLocator(state, states, fillRecord),
        locator: (sel: string) => makeLocator(states[sel] ?? state, states, fillRecord),
        waitFor: vi.fn(async () => {
            if (state.waitFails) throw new Error("not found");
        }),
        click: vi.fn(async () => {
            if (state.clickThrows) throw new Error("click failed");
        }),
        fill: vi.fn(async (value: string) => {
            fillRecord?.push(value);
        }),
        isVisible: vi.fn(async () => state.visible ?? true),
        isChecked: vi.fn(async () => state.checked ?? false),
    };
}

function makePage(
    states: Record<string, LocatorState> = {},
    fillRecord?: string[],
    waitTimeoutRecord?: number[],
) {
    return {
        locator: vi.fn((sel: string) => makeLocator(states[sel] ?? {}, states, fillRecord)),
        waitForTimeout: vi.fn(async (ms: number) => {
            waitTimeoutRecord?.push(ms);
        }),
    } as never;
}

describe("importGear", () => {
    it("pastes the simc, toggles both checkboxes, and submits", async () => {
        const fills: string[] = [];
        const page = makePage({}, fills);
        await importGear(page, 'shaman="x"\r\nspec=restoration\n', {
            upgradeAllToMax: true,
            upgradeVaultToMax: true,
            postPasteSettleMs: 0,
        });
        // CRLF should be normalised to LF before fill.
        expect(fills.length).toBe(1);
        expect(fills[0]).not.toMatch(/\r/);
        expect(fills[0]).toContain('shaman="x"');
    });

    it("skips toggling a checkbox that is already in the desired state", async () => {
        const fills: string[] = [];
        const page = makePage({ 'input[type="checkbox"]': { checked: true } }, fills);
        await importGear(page, "x", { upgradeAllToMax: true, upgradeVaultToMax: true, postPasteSettleMs: 0 });
        expect(fills.length).toBe(1);
    });

    it("warns and continues when a checkbox click throws", async () => {
        const page = makePage({ label: { clickThrows: true } });
        // Should not throw — toggle warning is swallowed.
        await importGear(page, "x", { upgradeAllToMax: true, upgradeVaultToMax: true, postPasteSettleMs: 0 });
    });

    it("waits postPasteSettleMs after pasting when set", async () => {
        const fills: string[] = [];
        const waits: number[] = [];
        const page = makePage({}, fills, waits);
        await importGear(page, "x", {
            upgradeAllToMax: true,
            upgradeVaultToMax: true,
            postPasteSettleMs: 1234,
        });
        expect(waits).toContain(1234);
    });

    it("skips the settle wait when postPasteSettleMs is 0", async () => {
        const waits: number[] = [];
        const page = makePage({}, undefined, waits);
        await importGear(page, "x", {
            upgradeAllToMax: true,
            upgradeVaultToMax: true,
            postPasteSettleMs: 0,
        });
        expect(waits).not.toContain(0);
        expect(waits.length).toBe(0);
    });

    it("propagates the error when the dialog never appears", async () => {
        const page = makePage({ '[role="dialog"]': { waitFails: true } });
        await expect(
            importGear(page, "x", { upgradeAllToMax: true, upgradeVaultToMax: true, postPasteSettleMs: 0 }),
        ).rejects.toThrow();
    });
});
