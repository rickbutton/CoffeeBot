import { describe, expect, it, vi } from "vitest";
import { handleHelpCommand } from "./help.js";

describe("handleHelpCommand", () => {
    it("rejects non-admins", async () => {
        const reply = vi.fn<(opts: unknown) => Promise<undefined>>(async () => undefined);
        const i = { user: { id: "x" }, reply } as never;
        await handleHelpCommand(i, new Set(["admin"]));
        expect(reply).toHaveBeenCalledWith(
            expect.objectContaining({ content: expect.stringContaining("Admin only") }),
        );
    });

    it("returns the help body to admins", async () => {
        const reply = vi.fn<(opts: unknown) => Promise<undefined>>(async () => undefined);
        const i = { user: { id: "admin" }, reply } as never;
        await handleHelpCommand(i, new Set(["admin"]));
        const arg = reply.mock.calls[0]![0] as { content: string };
        expect(arg.content).toContain("/characters");
        expect(arg.content).toContain("/sim");
        expect(arg.content).toContain("/status");
    });
});
