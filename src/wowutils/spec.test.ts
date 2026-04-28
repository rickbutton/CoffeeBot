import { describe, expect, it } from "vitest";
import { classNameToWowutilsKey, specToWowutilsAlt } from "./spec.js";

describe("specToWowutilsAlt", () => {
    it("title-cases a single-word spec", () => {
        expect(specToWowutilsAlt("arcane")).toBe("Arcane");
        expect(specToWowutilsAlt("havoc")).toBe("Havoc");
        expect(specToWowutilsAlt("devourer")).toBe("Devourer");
    });

    it("splits snake_case into words", () => {
        expect(specToWowutilsAlt("beast_mastery")).toBe("Beast Mastery");
    });

    it("normalizes already-cased input", () => {
        expect(specToWowutilsAlt("BEAST_MASTERY")).toBe("Beast Mastery");
        expect(specToWowutilsAlt("Beast_Mastery")).toBe("Beast Mastery");
    });

    it("collapses repeated separators", () => {
        expect(specToWowutilsAlt("beast__mastery")).toBe("Beast Mastery");
        expect(specToWowutilsAlt(" beast   mastery ")).toBe("Beast Mastery");
    });

    it("returns null for missing spec", () => {
        expect(specToWowutilsAlt(null)).toBe(null);
        expect(specToWowutilsAlt(undefined)).toBe(null);
        expect(specToWowutilsAlt("")).toBe(null);
        expect(specToWowutilsAlt("   ")).toBe(null);
    });
});

describe("classNameToWowutilsKey", () => {
    it("passes through a single-word class lowercase", () => {
        expect(classNameToWowutilsKey("hunter")).toBe("hunter");
        expect(classNameToWowutilsKey("mage")).toBe("mage");
        expect(classNameToWowutilsKey("evoker")).toBe("evoker");
    });

    it("strips underscores from compound classes", () => {
        expect(classNameToWowutilsKey("death_knight")).toBe("deathknight");
        expect(classNameToWowutilsKey("demon_hunter")).toBe("demonhunter");
    });

    it("normalizes case and separators", () => {
        expect(classNameToWowutilsKey("Death Knight")).toBe("deathknight");
        expect(classNameToWowutilsKey("DEMON-HUNTER")).toBe("demonhunter");
    });

    it("returns null for missing input", () => {
        expect(classNameToWowutilsKey(null)).toBe(null);
        expect(classNameToWowutilsKey(undefined)).toBe(null);
        expect(classNameToWowutilsKey("")).toBe(null);
        expect(classNameToWowutilsKey("   ")).toBe(null);
    });
});
