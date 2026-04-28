import { describe, expect, it, vi } from "vitest";
import { notifyAdmins } from "./notify.js";

describe("notifyAdmins", () => {
    it("sends a DM to each admin and tolerates failures", async () => {
        const sent: string[] = [];
        const client = {
            users: {
                fetch: async (id: string) => {
                    if (id === "bad") throw new Error("nope");
                    return {
                        createDM: async () => ({
                            send: async () => {
                                sent.push(id);
                            },
                        }),
                    };
                },
            },
        } as never;
        await notifyAdmins(client, ["a1", "a2", "bad"], "hi");
        expect(sent.sort()).toEqual(["a1", "a2"]);
    });

    it("does nothing for empty admin set", async () => {
        const fetch = vi.fn();
        await notifyAdmins({ users: { fetch } } as never, [], "hi");
        expect(fetch).not.toHaveBeenCalled();
    });
});
