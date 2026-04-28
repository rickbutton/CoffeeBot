import { describe, expect, it } from "vitest";
import type { WowutilsReport } from "./select.js";
import { buildWowutilsScript, DEFAULT_OPTIONS } from "./script.js";

const sampleReport = (overrides: Partial<WowutilsReport> = {}): WowutilsReport => ({
    characterName: "Apex",
    classKey: "hunter",
    spec: "Beast Mastery",
    reportUrl: "https://www.raidbots.com/simbot/report/abc",
    ...overrides,
});

describe("buildWowutilsScript", () => {
    it("embeds the report list as a JSON literal in the snippet", () => {
        const reports = [sampleReport()];
        const script = buildWowutilsScript(reports);
        expect(script).toContain('"characterName": "Apex"');
        expect(script).toContain('"classKey": "hunter"');
        expect(script).toContain('"spec": "Beast Mastery"');
        expect(script).toContain('"reportUrl": "https://www.raidbots.com/simbot/report/abc"');
    });

    it("embeds the default options when no overrides are passed", () => {
        const script = buildWowutilsScript([sampleReport()]);
        for (const value of Object.values(DEFAULT_OPTIONS)) {
            expect(script).toContain(String(value));
        }
    });

    it("merges option overrides on top of the defaults", () => {
        const script = buildWowutilsScript([sampleReport()], {
            minActionDelayMs: 1,
            maxActionDelayMs: 2,
            minBetweenCharsMs: 3,
            maxBetweenCharsMs: 4,
            perStepTimeoutMs: 5,
        });
        expect(script).toContain('"minActionDelayMs": 1');
        expect(script).toContain('"perStepTimeoutMs": 5');
    });

    it("uses the row title selector that wowutils actually exposes", () => {
        const script = buildWowutilsScript([sampleReport()]);
        // The title attribute is the only stable handle wowutils gives us per row.
        expect(script).toContain('button[title="Import droptimizer for ');
    });

    it("clicks the All filter so alts are visible before iterating", () => {
        const script = buildWowutilsScript([sampleReport()]);
        expect(script).toContain('findButton("All", { exact: true })');
    });

    it("disambiguates same-name rows by classKey, handling both pre-import and post-import row icons", () => {
        const script = buildWowutilsScript([sampleReport()]);
        // The script's row-disambiguator must work for rows that have an imported
        // sim (class-icons path) as well as rows that don't (spec-icons path).
        expect(script).toContain("spec-icons");
        expect(script).toContain("class-icons");
        // And classKey must be plumbed into the JS body (not just the embedded data).
        expect(script).toContain('"/" + classKey');
    });

    it("aborts the import on a class-mismatch warning instead of silently writing garbage", () => {
        const script = buildWowutilsScript([sampleReport()]);
        expect(script).toContain("but you are importing for");
        expect(script).toContain('findButton("Back"');
    });

    it("waits for the success banner and tracks summary counts", () => {
        const script = buildWowutilsScript([sampleReport()]);
        expect(script).toContain("Imported");
        expect(script).toContain("uploaded:");
        expect(script).toContain("failed:");
        expect(script).toContain("skipped:");
    });

    it("starts as a self-invoking async IIFE so it runs when pasted into devtools", () => {
        const script = buildWowutilsScript([sampleReport()]);
        expect(script.trimStart().startsWith("(async () => {")).toBe(true);
        expect(script.trimEnd().endsWith("})();")).toBe(true);
    });

    it("handles an empty report list (still a valid IIFE)", () => {
        const script = buildWowutilsScript([]);
        expect(script).toContain("const REPORTS = []");
        expect(script.trimStart().startsWith("(async () => {")).toBe(true);
    });
});
