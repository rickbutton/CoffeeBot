import { describe, expect, it, vi } from "vitest";
import { makeRaidbotsExecutor } from "./executor.js";
import * as automation from "./automation.js";

describe("makeRaidbotsExecutor", () => {
    it("returns ok with a report URL when automation succeeds", async () => {
        const spy = vi.spyOn(automation, "runDroptimizer").mockResolvedValue({
            ok: true,
            reportUrl: "https://x/r/abc",
            reportId: "abc",
            completed: true,
        });
        try {
            const exec = makeRaidbotsExecutor({} as never, null);
            const r = await exec({ id: 1, simcSnapshot: "raw" } as never);
            expect(r).toEqual({
                ok: true,
                reportUrl: "https://x/r/abc",
            });
        } finally {
            spy.mockRestore();
        }
    });

    it("returns failure when automation returns error", async () => {
        const spy = vi.spyOn(automation, "runDroptimizer").mockResolvedValue({
            ok: false,
            error: "boom",
        });
        try {
            const exec = makeRaidbotsExecutor({} as never, null);
            const r = await exec({ id: 1, simcSnapshot: "raw" } as never);
            expect(r).toEqual({ ok: false, error: "boom" });
        } finally {
            spy.mockRestore();
        }
    });

    it("returns failure when automation returns the submit-skipped sentinel", async () => {
        const spy = vi.spyOn(automation, "runDroptimizer").mockResolvedValue({
            ok: true,
            submitted: false,
        });
        try {
            const exec = makeRaidbotsExecutor({} as never, null);
            const r = await exec({ id: 1, simcSnapshot: "raw" } as never);
            if (r.ok) throw new Error("expected failure");
            expect(r.error).toMatch(/without submitting/);
        } finally {
            spy.mockRestore();
        }
    });
});
