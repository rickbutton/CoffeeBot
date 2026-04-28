import { describe, expect, it } from "vitest";
import { evaluateGate, jitterDelayMs, utcDayStart } from "./pacing.js";

const CFG = {
    minDelaySeconds: 60,
    maxDelaySeconds: 120,
    dailyCap: 5,
};

describe("jitterDelayMs", () => {
    it("returns a value in [min, max) ms with a deterministic rand", () => {
        expect(jitterDelayMs(CFG, () => 0)).toBe(60_000);
        expect(jitterDelayMs(CFG, () => 0.5)).toBe(90_000);
        expect(jitterDelayMs(CFG, () => 0.999999)).toBeLessThan(120_000);
    });
    it("returns min when min == max", () => {
        expect(jitterDelayMs({ ...CFG, maxDelaySeconds: 60 }, () => 0.5)).toBe(60_000);
    });
});

describe("evaluateGate", () => {
    it("allows when under cap", () => {
        expect(evaluateGate(CFG, new Date("2026-04-27T12:00:00Z"), 0)).toEqual({
            gate: "allow",
        });
    });

    it("blocks when at cap and resumes at next UTC midnight", () => {
        const now = new Date("2026-04-27T12:00:00Z");
        const r = evaluateGate(CFG, now, 5);
        if (r.gate !== "wait") throw new Error("expected wait");
        expect(r.reason).toMatch(/daily cap/);
        expect(new Date(r.resumeAtMs).toISOString()).toBe("2026-04-28T00:00:00.000Z");
    });
});

describe("utcDayStart", () => {
    it("zeros to UTC midnight", () => {
        expect(utcDayStart(new Date("2026-04-27T13:45:09.123Z")).toISOString()).toBe(
            "2026-04-27T00:00:00.000Z",
        );
    });
});
