import { describe, expect, it } from "vitest";
import { log } from "./log.js";

describe("log", () => {
    it("exports a pino-compatible logger with the standard methods", () => {
        expect(typeof log.info).toBe("function");
        expect(typeof log.warn).toBe("function");
        expect(typeof log.error).toBe("function");
        expect(typeof log.fatal).toBe("function");
    });
});
