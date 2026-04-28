import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { makeTestDb } from "../../test-utils/db.js";
import { listCharacters } from "../../db/repo.js";
import { processSimcMessage } from "./simc-paste.js";
import { VALID_SIMC } from "../../test-utils/factories.js";

function makeMsg(content: string, attachments: unknown[] = []) {
    return {
        content,
        author: { id: "user1" },
        attachments: { values: () => attachments[Symbol.iterator]?.() ?? attachments.values() },
    } as never;
}

describe("processSimcMessage", () => {
    it("returns no-content for an empty message with no attachments", async () => {
        const db = makeTestDb();
        const r = await processSimcMessage(db, makeMsg(""));
        expect(r.kind).toBe("no-content");
    });

    it("returns not-simc for short chatter", async () => {
        const db = makeTestDb();
        const r = await processSimcMessage(db, makeMsg("hey"));
        expect(r.kind).toBe("not-simc");
    });

    it("returns parse-error when class is found but server missing", async () => {
        const db = makeTestDb();
        const broken = `hunter="Bowzo"
region=us
spec=beast_mastery
` + "x".repeat(40);
        const r = await processSimcMessage(db, makeMsg(broken));
        expect(r.kind).toBe("parse-error");
    });

    it("returns missing-spec when spec= is absent", async () => {
        const db = makeTestDb();
        const noSpec = `hunter="Bowzo"
level=80
region=us
server=area-52
`;
        const r = await processSimcMessage(db, makeMsg(noSpec));
        expect(r.kind).toBe("missing-spec");
    });

    it("stores a valid simc and returns stored:true on first paste", async () => {
        const db = makeTestDb();
        const r = await processSimcMessage(db, makeMsg(VALID_SIMC));
        expect(r.kind).toBe("stored");
        if (r.kind !== "stored") return;
        expect(r.created).toBe(true);
        expect(r.enqueue.enqueued).toBe(1);
        expect(listCharacters(db, "user1")).toHaveLength(1);
        const r2 = await processSimcMessage(db, makeMsg(VALID_SIMC));
        if (r2.kind !== "stored") return;
        expect(r2.created).toBe(false);
        expect(r2.enqueue.enqueued).toBe(0);
        expect(r2.enqueue.skippedDuplicate).toBe(1);
    });

    it("returns store-error when DB write throws", async () => {
        const db = makeTestDb();
        // Force upsertCharacter to throw by closing the underlying db connection.
        // Simpler: stub the db to throw on insert.
        const repo = await import("../../db/repo.js");
        const spy = vi.spyOn(repo, "upsertCharacter").mockImplementation(() => {
            throw new Error("db is dead");
        });
        try {
            const r = await processSimcMessage(db, makeMsg(VALID_SIMC));
            expect(r.kind).toBe("store-error");
        } finally {
            spy.mockRestore();
        }
    });
});

describe("processSimcMessage with attachments", () => {
    const originalFetch = globalThis.fetch;
    beforeEach(() => {
        globalThis.fetch = vi.fn(async () =>
            ({ ok: true, text: async () => VALID_SIMC }) as never,
        ) as unknown as typeof fetch;
    });
    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it("reads a .txt attachment when message body is empty", async () => {
        const db = makeTestDb();
        const r = await processSimcMessage(
            db,
            makeMsg("", [
                { url: "https://x/x.txt", name: "x.txt", size: 100, contentType: "text/plain" },
            ]),
        );
        expect(r.kind).toBe("stored");
    });

    it("skips an attachment that's too large", async () => {
        const db = makeTestDb();
        const r = await processSimcMessage(
            db,
            makeMsg("", [
                {
                    url: "https://x/x.txt",
                    name: "x.txt",
                    size: 5_000_000,
                    contentType: "text/plain",
                },
            ]),
        );
        expect(r.kind).toBe("no-content");
    });

    it("accepts octet-stream when filename ends with .simc", async () => {
        const db = makeTestDb();
        const r = await processSimcMessage(
            db,
            makeMsg("", [
                {
                    url: "https://x/x.simc",
                    name: "x.simc",
                    size: 100,
                    contentType: "application/octet-stream",
                },
            ]),
        );
        expect(r.kind).toBe("stored");
    });

    it("rejects attachment with unsupported contentType", async () => {
        const db = makeTestDb();
        const r = await processSimcMessage(
            db,
            makeMsg("", [
                { url: "https://x/x.bin", name: "x.bin", size: 100, contentType: "image/png" },
            ]),
        );
        expect(r.kind).toBe("no-content");
    });

    it("handles fetch failure (non-ok response) gracefully", async () => {
        globalThis.fetch = vi.fn(async () => ({ ok: false, text: async () => "" }) as never) as unknown as typeof fetch;
        const db = makeTestDb();
        const r = await processSimcMessage(
            db,
            makeMsg("", [
                { url: "https://x/x.txt", name: "x.txt", size: 100, contentType: "text/plain" },
            ]),
        );
        expect(r.kind).toBe("no-content");
    });

    it("handles fetch throw gracefully", async () => {
        globalThis.fetch = vi.fn(async () => {
            throw new Error("network");
        }) as unknown as typeof fetch;
        const db = makeTestDb();
        const r = await processSimcMessage(
            db,
            makeMsg("", [
                { url: "https://x/x.txt", name: "x.txt", size: 100, contentType: "text/plain" },
            ]),
        );
        expect(r.kind).toBe("no-content");
    });
});
