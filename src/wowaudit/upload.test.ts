import { describe, expect, it, vi } from "vitest";
import { extractReportId, makeUploader, uploadWishlist, type FetchLike } from "./upload.js";

const cfg = { apiKey: "test-key", baseUrl: "https://wowaudit.com/api" };

function fakeFetch(opts: { ok: boolean; status?: number; body?: string }): FetchLike {
    return vi.fn(async () => ({
        ok: opts.ok,
        status: opts.status ?? (opts.ok ? 200 : 500),
        text: async () => opts.body ?? "",
    }));
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

    it("returns null when the URL doesn't have a report id", () => {
        expect(extractReportId("https://raidbots.com/")).toBe(null);
        expect(extractReportId("not a url")).toBe(null);
    });
});

describe("uploadWishlist", () => {
    it("posts to /v1/wishlists with the expected headers and body", async () => {
        const calls: Parameters<FetchLike>[] = [];
        const fetchFn: FetchLike = async (url, init) => {
            calls.push([url, init]);
            return { ok: true, status: 201, text: async () => "" };
        };
        const r = await uploadWishlist(
            cfg,
            { reportId: "rep1", characterName: "Bowzo" },
            fetchFn,
        );
        expect(r.ok).toBe(true);
        expect(calls).toHaveLength(1);
        const [url, init] = calls[0]!;
        expect(url).toBe("https://wowaudit.com/api/v1/wishlists");
        expect(init.method).toBe("POST");
        expect(init.headers.Authorization).toBe("Bearer test-key");
        expect(init.headers["Content-Type"]).toBe("application/json");
        const body = JSON.parse(init.body);
        expect(body).toEqual({
            report_id: "rep1",
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
            { reportId: "r", characterName: "n" },
            fetchFn,
        );
        expect(calls[0]![0]).toBe("https://wowaudit.com/api/v1/wishlists");
    });

    it("returns ok:false with status and body excerpt on non-2xx", async () => {
        const fetchFn = fakeFetch({ ok: false, status: 422, body: "invalid character" });
        const r = await uploadWishlist(
            cfg,
            { reportId: "r", characterName: "n" },
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
        const r = await uploadWishlist(cfg, { reportId: "r", characterName: "n" }, fetchFn);
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.error).toMatch(/ECONNRESET/);
    });

    it("survives a non-Error throw", async () => {
        const fetchFn = vi.fn(async () => {
            throw "boom";
        }) as unknown as FetchLike;
        const r = await uploadWishlist(cfg, { reportId: "r", characterName: "n" }, fetchFn);
        expect(r.ok).toBe(false);
    });

    it("survives res.text() throwing on a failure response", async () => {
        const fetchFn = vi.fn(async () => ({
            ok: false,
            status: 500,
            text: async () => {
                throw new Error("text decode");
            },
        })) as unknown as FetchLike;
        const r = await uploadWishlist(cfg, { reportId: "r", characterName: "n" }, fetchFn);
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.error).toMatch(/500/);
    });
});

describe("makeUploader", () => {
    it("returns uploaded:false (and skips the POST) when the report URL has no id", async () => {
        const fetchFn = fakeFetch({ ok: true });
        const upload = makeUploader(cfg, fetchFn);
        const r = await upload({ jobId: 1, reportUrl: "garbage", characterName: "Bowzo" });
        expect(r.uploaded).toBe(false);
        expect(fetchFn).not.toHaveBeenCalled();
    });

    it("returns uploaded:true on a 2xx response", async () => {
        const fetchFn = fakeFetch({ ok: true });
        const upload = makeUploader(cfg, fetchFn);
        const r = await upload({
            jobId: 1,
            reportUrl: "https://www.raidbots.com/simbot/report/abc",
            characterName: "Bowzo",
        });
        expect(r.uploaded).toBe(true);
        expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it("returns uploaded:false (and logs) on a 4xx response", async () => {
        const fetchFn = fakeFetch({ ok: false, status: 401, body: "unauthorized" });
        const upload = makeUploader(cfg, fetchFn);
        const r = await upload({
            jobId: 1,
            reportUrl: "https://www.raidbots.com/simbot/report/abc",
            characterName: "Bowzo",
        });
        expect(r.uploaded).toBe(false);
    });
});
