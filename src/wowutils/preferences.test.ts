import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadPreferences, preferenceKey, savePreferences } from "./preferences.js";

function tmpPath(name = "prefs.json"): string {
    const dir = mkdtempSync(join(tmpdir(), "wowutils-prefs-"));
    return join(dir, name);
}

describe("preferenceKey", () => {
    it("lowercases each component and joins with pipes", () => {
        expect(preferenceKey("US", "Illidan", "Apex")).toBe("us|illidan|apex");
        expect(preferenceKey("us", "illidan", "apex")).toBe("us|illidan|apex");
    });
});

describe("loadPreferences", () => {
    it("returns empty when the file doesn't exist", () => {
        expect(loadPreferences(tmpPath())).toEqual({});
    });

    it("parses a previously-written file", () => {
        const path = tmpPath();
        writeFileSync(path, JSON.stringify({ "us|illidan|apex": "marksmanship" }), "utf8");
        expect(loadPreferences(path)).toEqual({ "us|illidan|apex": "marksmanship" });
    });

    it("falls back to empty on malformed JSON", () => {
        const path = tmpPath();
        writeFileSync(path, "not json", "utf8");
        expect(loadPreferences(path)).toEqual({});
    });

    it("ignores non-string values", () => {
        const path = tmpPath();
        writeFileSync(
            path,
            JSON.stringify({ "us|illidan|apex": "arcane", "us|illidan|bow": 42 }),
            "utf8",
        );
        expect(loadPreferences(path)).toEqual({ "us|illidan|apex": "arcane" });
    });

    it("returns empty when the JSON root is not an object", () => {
        const path = tmpPath();
        writeFileSync(path, JSON.stringify(["arcane"]), "utf8");
        expect(loadPreferences(path)).toEqual({});
    });
});

describe("savePreferences", () => {
    it("writes pretty-printed, key-sorted JSON", () => {
        const path = tmpPath();
        savePreferences(path, {
            "us|illidan|zeta": "destruction",
            "us|illidan|alpha": "arcane",
        });
        const round = readFileSync(path, "utf8");
        expect(round.endsWith("\n")).toBe(true);
        const parsed = JSON.parse(round);
        expect(Object.keys(parsed)).toEqual(["us|illidan|alpha", "us|illidan|zeta"]);
    });

    it("creates the parent directory if it doesn't exist", () => {
        const dir = mkdtempSync(join(tmpdir(), "wowutils-deep-"));
        const path = join(dir, "nested", "child", "prefs.json");
        savePreferences(path, { foo: "bar" });
        expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ foo: "bar" });
    });
});
