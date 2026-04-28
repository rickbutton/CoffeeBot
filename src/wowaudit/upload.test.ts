import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { characters } from "../db/schema.js";
import { upsertCharacter } from "../db/repo.js";
import { sampleCharacter as sample } from "../test-utils/factories.js";
import { makeTestDb } from "../test-utils/db.js";
import {
    extractReportId,
    getWowauditWishlist,
    listWowauditCharacters,
    makeUploader,
    resolveWowauditId,
    uploadWishlist,
    type FetchLike,
} from "./upload.js";

const cfg = { apiKey: "test-key", baseUrl: "https://wowaudit.com/api" };

function fakeFetch(opts: { ok: boolean; status?: number; body?: string }): FetchLike {
    return vi.fn(async () => ({
        ok: opts.ok,
        status: opts.status ?? (opts.ok ? 200 : 500),
        text: async () => opts.body ?? "",
    }));
}

/**
 * Routes fetch calls by URL to a sequence of fixed responses. The same path can
 * appear multiple times — useful for the pre-/post-upload GET pair.
 */
function routedFetch(
    routes: Record<string, Array<{ ok: boolean; status?: number; body?: string }>>,
): FetchLike & { calls: Array<{ url: string; method: string; body?: string }> } {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    const fn: FetchLike = async (url, init) => {
        calls.push({ url, method: init.method, body: init.body });
        for (const key of Object.keys(routes)) {
            if (url.endsWith(key)) {
                const next = routes[key]!.shift();
                if (!next) throw new Error(`route exhausted for ${key}`);
                return {
                    ok: next.ok,
                    status: next.status ?? (next.ok ? 200 : 500),
                    text: async () => next.body ?? "",
                };
            }
        }
        throw new Error(`unmocked URL: ${url}`);
    };
    return Object.assign(fn, { calls });
}

function mkCharacter(db: ReturnType<typeof makeTestDb>, overrides = {}) {
    const id = upsertCharacter(db, "u1", sample(overrides as object), "raw").id;
    return db.select().from(characters).where(eq(characters.id, id)).get()!;
}

describe("extractReportId", () => {
    it("pulls the id from a canonical raidbots report URL", () => {
        expect(extractReportId("https://www.raidbots.com/simbot/report/AbC123_xy-Z")).toBe(
            "AbC123_xy-Z",
        );
    });
    it("works without the www", () => {
        expect(extractReportId("https://raidbots.com/simbot/report/zzz")).toBe("zzz");
    });
    it("pulls the id from a QELive upgrade-finder URL", () => {
        expect(
            extractReportId("https://questionablyepic.com/live/upgradereport/huqlwvjiurlq"),
        ).toBe("huqlwvjiurlq");
    });
    it("returns null when the URL doesn't have a report id", () => {
        expect(extractReportId("https://raidbots.com/")).toBe(null);
        expect(extractReportId("not a url")).toBe(null);
    });
});

describe("uploadWishlist", () => {
    it("posts to /v1/wishlists with character_id and the expected body", async () => {
        const calls: Parameters<FetchLike>[] = [];
        const fetchFn: FetchLike = async (url, init) => {
            calls.push([url, init]);
            return { ok: true, status: 201, text: async () => "" };
        };
        const r = await uploadWishlist(
            cfg,
            { reportId: "rep1", characterName: "Bowzo", characterId: 42 },
            fetchFn,
        );
        expect(r.ok).toBe(true);
        const [url, init] = calls[0]!;
        expect(url).toBe("https://wowaudit.com/api/v1/wishlists");
        expect(init.method).toBe("POST");
        expect(init.headers.Authorization).toBe("Bearer test-key");
        expect(init.headers["Content-Type"]).toBe("application/json");
        expect(JSON.parse(init.body!)).toEqual({
            report_id: "rep1",
            character_id: 42,
            character_name: "Bowzo",
            replace_manual_edits: true,
            clear_conduits: true,
        });
    });

    it("strips trailing slashes from the base URL", async () => {
        const calls: Parameters<FetchLike>[] = [];
        const fetchFn: FetchLike = async (url, init) => {
            calls.push([url, init]);
            return { ok: true, status: 200, text: async () => "" };
        };
        await uploadWishlist(
            { ...cfg, baseUrl: "https://wowaudit.com/api/" },
            { reportId: "r", characterName: "n", characterId: 1 },
            fetchFn,
        );
        expect(calls[0]![0]).toBe("https://wowaudit.com/api/v1/wishlists");
    });

    it("returns ok:false with status and body excerpt on non-2xx", async () => {
        const fetchFn = fakeFetch({ ok: false, status: 422, body: "invalid character" });
        const r = await uploadWishlist(
            cfg,
            { reportId: "r", characterName: "n", characterId: 1 },
            fetchFn,
        );
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.error).toMatch(/422/);
        expect(r.error).toMatch(/invalid character/);
    });

    it("survives a fetch that throws", async () => {
        const fetchFn = vi.fn(async () => {
            throw new Error("ECONNRESET");
        }) as unknown as FetchLike;
        const r = await uploadWishlist(
            cfg,
            { reportId: "r", characterName: "n", characterId: 1 },
            fetchFn,
        );
        expect(r.ok).toBe(false);
    });
});

describe("listWowauditCharacters", () => {
    it("parses the array response", async () => {
        const fetchFn = fakeFetch({
            ok: true,
            body: JSON.stringify([
                { id: 4, name: "Bexey", realm: "Stormrage", role: "Ranged" },
                { id: 2, name: "Kormash", realm: "Stormrage", role: "Tank" },
            ]),
        });
        const r = await listWowauditCharacters(cfg, fetchFn);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.characters).toEqual([
            { id: 4, name: "Bexey", realm: "Stormrage" },
            { id: 2, name: "Kormash", realm: "Stormrage" },
        ]);
    });

    it("drops malformed roster entries", async () => {
        const fetchFn = fakeFetch({
            ok: true,
            body: JSON.stringify([
                { id: 4, name: "Bexey", realm: "Stormrage" },
                { id: "string-id", name: "Bad", realm: "Stormrage" },
                "junk",
            ]),
        });
        const r = await listWowauditCharacters(cfg, fetchFn);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.characters).toHaveLength(1);
    });

    it("errors on non-array response", async () => {
        const fetchFn = fakeFetch({ ok: true, body: '{"not":"array"}' });
        const r = await listWowauditCharacters(cfg, fetchFn);
        expect(r.ok).toBe(false);
    });

    it("errors on non-2xx", async () => {
        const fetchFn = fakeFetch({ ok: false, status: 401, body: "unauthorized" });
        const r = await listWowauditCharacters(cfg, fetchFn);
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.error).toMatch(/401/);
    });

    it("survives a fetch that throws", async () => {
        const fetchFn = vi.fn(async () => {
            throw new Error("boom");
        }) as unknown as FetchLike;
        const r = await listWowauditCharacters(cfg, fetchFn);
        expect(r.ok).toBe(false);
    });
});

describe("getWowauditWishlist", () => {
    it("returns the raw response body on 200", async () => {
        const fetchFn = fakeFetch({ ok: true, body: '{"updated_at":"2026-01-01"}' });
        const r = await getWowauditWishlist(cfg, 4, fetchFn);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.body).toBe('{"updated_at":"2026-01-01"}');
    });

    it("errors on non-2xx", async () => {
        const fetchFn = fakeFetch({ ok: false, status: 404, body: "not found" });
        const r = await getWowauditWishlist(cfg, 999, fetchFn);
        expect(r.ok).toBe(false);
    });

    it("survives a fetch that throws", async () => {
        const fetchFn = vi.fn(async () => {
            throw new Error("net");
        }) as unknown as FetchLike;
        const r = await getWowauditWishlist(cfg, 1, fetchFn);
        expect(r.ok).toBe(false);
    });
});

describe("resolveWowauditId", () => {
    it("returns the cached id without calling the API", async () => {
        const db = makeTestDb();
        const c = mkCharacter(db);
        db.update(characters).set({ wowauditId: 99 }).where(eq(characters.id, c.id)).run();
        const cached = db.select().from(characters).where(eq(characters.id, c.id)).get()!;
        const fetchFn = vi.fn() as unknown as FetchLike;
        const r = await resolveWowauditId(cfg, db, cached, fetchFn);
        expect(r).toEqual({ ok: true, wowauditId: 99 });
        expect(fetchFn).not.toHaveBeenCalled();
    });

    it("looks up by name+realm (case-insensitive) and caches the id", async () => {
        const db = makeTestDb();
        const c = mkCharacter(db, { name: "Bowzo", realm: "area-52" });
        const fetchFn = fakeFetch({
            ok: true,
            body: JSON.stringify([
                { id: 7, name: "Bexey", realm: "Stormrage" },
                { id: 13, name: "BOWZO", realm: "Area-52" },
            ]),
        });
        const r = await resolveWowauditId(cfg, db, c, fetchFn);
        expect(r).toEqual({ ok: true, wowauditId: 13 });
        const reloaded = db.select().from(characters).where(eq(characters.id, c.id)).get()!;
        expect(reloaded.wowauditId).toBe(13);
    });

    it("strips a trailing region suffix from the realm when comparing", async () => {
        const db = makeTestDb();
        const c = mkCharacter(db, { name: "Bowzo", realm: "Stormrage" });
        const fetchFn = fakeFetch({
            ok: true,
            body: JSON.stringify([{ id: 5, name: "Bowzo", realm: "Stormrage-US" }]),
        });
        const r = await resolveWowauditId(cfg, db, c, fetchFn);
        expect(r).toEqual({ ok: true, wowauditId: 5 });
    });

    it("returns error if no matching roster entry exists", async () => {
        const db = makeTestDb();
        const c = mkCharacter(db, { name: "Ghost", realm: "Nowhere" });
        const fetchFn = fakeFetch({
            ok: true,
            body: JSON.stringify([{ id: 7, name: "Bexey", realm: "Stormrage" }]),
        });
        const r = await resolveWowauditId(cfg, db, c, fetchFn);
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.error).toMatch(/no wowaudit roster entry/i);
        expect(r.error).toMatch(/Ghost/);
    });

    it("returns error when listCharacters fails", async () => {
        const db = makeTestDb();
        const c = mkCharacter(db);
        const fetchFn = fakeFetch({ ok: false, status: 500, body: "boom" });
        const r = await resolveWowauditId(cfg, db, c, fetchFn);
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.error).toMatch(/roster fetch failed/i);
    });
});

describe("makeUploader", () => {
    function bowzo(db: ReturnType<typeof makeTestDb>, wowauditId: number | null = null) {
        const c = mkCharacter(db, { name: "Bowzo", realm: "Stormrage" });
        if (wowauditId !== null) {
            db.update(characters)
                .set({ wowauditId })
                .where(eq(characters.id, c.id))
                .run();
            return db.select().from(characters).where(eq(characters.id, c.id)).get()!;
        }
        return c;
    }

    it("returns uploaded:false when the report URL has no id", async () => {
        const db = makeTestDb();
        const character = bowzo(db, 13);
        const upload = makeUploader(cfg, db, { fetchFn: vi.fn() as unknown as FetchLike });
        const r = await upload({ jobId: 1, reportUrl: "garbage", character });
        expect(r.uploaded).toBe(false);
    });

    it("happy path: resolves id, pre-fetches, posts, settles, post-fetches, body changed", async () => {
        const db = makeTestDb();
        const character = bowzo(db);
        const fetchFn = routedFetch({
            "/v1/characters": [
                { ok: true, body: JSON.stringify([{ id: 13, name: "Bowzo", realm: "Stormrage" }]) },
            ],
            "/v1/wishlists/13": [
                { ok: true, body: '{"updated":"before"}' },
                { ok: true, body: '{"updated":"after"}' },
            ],
            "/v1/wishlists": [{ ok: true, body: "" }],
        });
        const sleep = vi.fn(async () => {});
        const upload = makeUploader(cfg, db, { fetchFn, sleep, settleMs: 42 });
        const r = await upload({
            jobId: 1,
            reportUrl: "https://www.raidbots.com/simbot/report/abc",
            character,
        });
        expect(r.uploaded).toBe(true);
        expect(sleep).toHaveBeenCalledWith(42);
        // 4 calls: list, pre-get, post, post-get
        expect(fetchFn.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
            "GET https://wowaudit.com/api/v1/characters",
            "GET https://wowaudit.com/api/v1/wishlists/13",
            "POST https://wowaudit.com/api/v1/wishlists",
            "GET https://wowaudit.com/api/v1/wishlists/13",
        ]);
    });

    it("uses cached wowaudit_id and skips the roster fetch", async () => {
        const db = makeTestDb();
        const character = bowzo(db, 13);
        const fetchFn = routedFetch({
            "/v1/wishlists/13": [
                { ok: true, body: '{"v":1}' },
                { ok: true, body: '{"v":2}' },
            ],
            "/v1/wishlists": [{ ok: true, body: "" }],
        });
        const upload = makeUploader(cfg, db, { fetchFn, sleep: async () => {} });
        const r = await upload({
            jobId: 1,
            reportUrl: "https://www.raidbots.com/simbot/report/abc",
            character,
        });
        expect(r.uploaded).toBe(true);
        expect(fetchFn.calls.find((c) => c.url.endsWith("/v1/characters"))).toBeUndefined();
    });

    it("returns uploaded:false when the wishlist body is byte-identical pre and post", async () => {
        const db = makeTestDb();
        const character = bowzo(db, 13);
        const fetchFn = routedFetch({
            "/v1/wishlists/13": [
                { ok: true, body: '{"same":"body"}' },
                { ok: true, body: '{"same":"body"}' },
            ],
            "/v1/wishlists": [{ ok: true, body: "" }],
        });
        const upload = makeUploader(cfg, db, { fetchFn, sleep: async () => {} });
        const r = await upload({
            jobId: 1,
            reportUrl: "https://www.raidbots.com/simbot/report/abc",
            character,
        });
        expect(r.uploaded).toBe(false);
    });

    it("returns uploaded:false when the resolver fails (no matching roster row)", async () => {
        const db = makeTestDb();
        const character = bowzo(db);
        const fetchFn = routedFetch({
            "/v1/characters": [{ ok: true, body: JSON.stringify([]) }],
        });
        const upload = makeUploader(cfg, db, { fetchFn, sleep: async () => {} });
        const r = await upload({
            jobId: 1,
            reportUrl: "https://www.raidbots.com/simbot/report/abc",
            character,
        });
        expect(r.uploaded).toBe(false);
    });

    it("returns uploaded:false when the pre-upload fetch fails", async () => {
        const db = makeTestDb();
        const character = bowzo(db, 13);
        const fetchFn = routedFetch({
            "/v1/wishlists/13": [{ ok: false, status: 503, body: "down" }],
        });
        const upload = makeUploader(cfg, db, { fetchFn, sleep: async () => {} });
        const r = await upload({
            jobId: 1,
            reportUrl: "https://www.raidbots.com/simbot/report/abc",
            character,
        });
        expect(r.uploaded).toBe(false);
    });

    it("returns uploaded:false when the POST fails", async () => {
        const db = makeTestDb();
        const character = bowzo(db, 13);
        const fetchFn = routedFetch({
            "/v1/wishlists/13": [{ ok: true, body: '{"v":1}' }],
            "/v1/wishlists": [{ ok: false, status: 422, body: "bad" }],
        });
        const upload = makeUploader(cfg, db, { fetchFn, sleep: async () => {} });
        const r = await upload({
            jobId: 1,
            reportUrl: "https://www.raidbots.com/simbot/report/abc",
            character,
        });
        expect(r.uploaded).toBe(false);
    });

    it("returns uploaded:false when the post-upload verify fetch fails", async () => {
        const db = makeTestDb();
        const character = bowzo(db, 13);
        const fetchFn = routedFetch({
            "/v1/wishlists/13": [
                { ok: true, body: '{"v":1}' },
                { ok: false, status: 503, body: "down" },
            ],
            "/v1/wishlists": [{ ok: true, body: "" }],
        });
        const upload = makeUploader(cfg, db, { fetchFn, sleep: async () => {} });
        const r = await upload({
            jobId: 1,
            reportUrl: "https://www.raidbots.com/simbot/report/abc",
            character,
        });
        expect(r.uploaded).toBe(false);
    });
});
