import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("playwright", () => {
    const launched: { args: unknown[] }[] = [];
    const fakeContext = {
        close: vi.fn(async () => {}),
    };
    return {
        chromium: {
            launchPersistentContext: vi.fn(async (...args: unknown[]) => {
                launched.push({ args });
                return fakeContext;
            }),
        },
        __launched: launched,
        __fakeContext: fakeContext,
    };
});

describe("RaidbotsSession", () => {
    it("launches lazily, returns the same context, and closes it", async () => {
        const { RaidbotsSession } = await import("./session.js");
        const playwright = (await import("playwright")) as unknown as {
            chromium: { launchPersistentContext: ReturnType<typeof vi.fn> };
            __fakeContext: { close: ReturnType<typeof vi.fn> };
        };
        const dir = mkdtempSync(join(tmpdir(), "rbs-"));
        const s = new RaidbotsSession({ userDataDir: dir, headless: true });

        const a = await s.getContext();
        const b = await s.getContext();
        expect(a).toBe(b);
        expect(playwright.chromium.launchPersistentContext).toHaveBeenCalledTimes(1);

        await s.close();
        expect(playwright.__fakeContext.close).toHaveBeenCalledOnce();

        // Closing again is a no-op.
        await s.close();
    });

    it("tolerates errors when closing", async () => {
        const { RaidbotsSession } = await import("./session.js");
        const playwright = (await import("playwright")) as unknown as {
            chromium: { launchPersistentContext: ReturnType<typeof vi.fn> };
            __fakeContext: { close: ReturnType<typeof vi.fn> };
        };
        playwright.__fakeContext.close.mockImplementationOnce(async () => {
            throw new Error("nope");
        });
        const dir = mkdtempSync(join(tmpdir(), "rbs-"));
        const s = new RaidbotsSession({ userDataDir: dir, headless: false });
        await s.getContext();
        await s.close();
    });
});
