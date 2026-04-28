import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { characters, type Character } from "../db/schema.js";
import { log } from "../util/log.js";

export type WowauditConfig = {
    apiKey: string;
    baseUrl: string;
};

export type FetchLike = (
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

// Raidbots droptimizer URLs and QELive Upgrade Finder URLs both encode the
// report id as the last path segment under their respective namespaces.
const REPORT_ID_PATTERNS = [
    /\/simbot\/report\/([A-Za-z0-9_-]+)/,
    /\/live\/upgradereport\/([A-Za-z0-9_-]+)/,
];

export function extractReportId(reportUrl: string): string | null {
    for (const re of REPORT_ID_PATTERNS) {
        const m = reportUrl.match(re);
        if (m) return m[1] ?? null;
    }
    return null;
}

function baseUrl(cfg: WowauditConfig): string {
    return cfg.baseUrl.replace(/\/+$/, "");
}

function authHeaders(cfg: WowauditConfig): Record<string, string> {
    return {
        Authorization: `Bearer ${cfg.apiKey}`,
        Accept: "application/json",
    };
}

export type WowauditCharacterRow = {
    id: number;
    name: string;
    realm: string;
};

/** GET /v1/characters — full roster (id, name, realm at minimum). */
export async function listWowauditCharacters(
    cfg: WowauditConfig,
    fetchFn: FetchLike,
): Promise<{ ok: true; characters: WowauditCharacterRow[] } | { ok: false; error: string }> {
    try {
        const res = await fetchFn(`${baseUrl(cfg)}/v1/characters`, {
            method: "GET",
            headers: authHeaders(cfg),
        });
        if (!res.ok) {
            const body = await res.text().catch(() => "");
            return { ok: false, error: `HTTP ${res.status}: ${body.slice(0, 300)}` };
        }
        const text = await res.text();
        const parsed: unknown = JSON.parse(text);
        if (!Array.isArray(parsed)) {
            return { ok: false, error: "expected array response from /v1/characters" };
        }
        const rows: WowauditCharacterRow[] = [];
        for (const r of parsed) {
            if (
                r &&
                typeof r === "object" &&
                typeof (r as { id?: unknown }).id === "number" &&
                typeof (r as { name?: unknown }).name === "string" &&
                typeof (r as { realm?: unknown }).realm === "string"
            ) {
                const o = r as { id: number; name: string; realm: string };
                rows.push({ id: o.id, name: o.name, realm: o.realm });
            }
        }
        return { ok: true, characters: rows };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}

/** GET /v1/wishlists/{id} — used for verify. We only care about the raw body for diffing. */
export async function getWowauditWishlist(
    cfg: WowauditConfig,
    wowauditCharacterId: number,
    fetchFn: FetchLike,
): Promise<{ ok: true; body: string } | { ok: false; error: string }> {
    try {
        const res = await fetchFn(`${baseUrl(cfg)}/v1/wishlists/${wowauditCharacterId}`, {
            method: "GET",
            headers: authHeaders(cfg),
        });
        if (!res.ok) {
            const body = await res.text().catch(() => "");
            return { ok: false, error: `HTTP ${res.status}: ${body.slice(0, 300)}` };
        }
        const text = await res.text();
        return { ok: true, body: text };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}

export type WowauditUploadInput = {
    reportId: string;
    characterName: string;
    characterId: number;
};

export type WowauditUploadResult = { ok: true } | { ok: false; error: string };

/** POST /v1/wishlists — uploads a droptimizer report. The team is identified by the API key alone. */
export async function uploadWishlist(
    cfg: WowauditConfig,
    input: WowauditUploadInput,
    fetchFn: FetchLike,
): Promise<WowauditUploadResult> {
    try {
        const res = await fetchFn(`${baseUrl(cfg)}/v1/wishlists`, {
            method: "POST",
            headers: { ...authHeaders(cfg), "Content-Type": "application/json" },
            body: JSON.stringify({
                report_id: input.reportId,
                character_id: input.characterId,
                character_name: input.characterName,
                replace_manual_edits: true,
                clear_conduits: true,
            }),
        });
        if (!res.ok) {
            const body = await res.text().catch(() => "");
            return { ok: false, error: `HTTP ${res.status}: ${body.slice(0, 300)}` };
        }
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}

/**
 * Normalize a name or realm for cross-source comparison. Handles all of:
 *   - case differences ("Stormrage" vs "stormrage")
 *   - SimC realm slugs vs Blizzard display names ("area_52" vs "Area 52")
 *   - apostrophes ("Mal'Ganis" vs "malganis" vs "mal_ganis")
 *   - trailing region suffix ("Stormrage-US")
 */
function normalizeRealmOrName(s: string): string {
    return s
        .toLowerCase()
        .replace(/-[a-z]+$/i, "")
        .replace(/[^a-z0-9]/g, "");
}

/**
 * Resolve a local Character row to wowaudit's roster id, caching the result on
 * the row. Returns the id, or null with a reason if no roster row matches.
 */
export async function resolveWowauditId(
    cfg: WowauditConfig,
    db: Db,
    character: Character,
    fetchFn: FetchLike,
): Promise<{ ok: true; wowauditId: number } | { ok: false; error: string }> {
    if (character.wowauditId !== null && character.wowauditId !== undefined) {
        return { ok: true, wowauditId: character.wowauditId };
    }
    const list = await listWowauditCharacters(cfg, fetchFn);
    if (!list.ok) return { ok: false, error: `roster fetch failed: ${list.error}` };

    const wantedName = normalizeRealmOrName(character.name);
    const wantedRealm = normalizeRealmOrName(character.realm);
    const match = list.characters.find(
        (c) =>
            normalizeRealmOrName(c.name) === wantedName &&
            normalizeRealmOrName(c.realm) === wantedRealm,
    );
    if (!match) {
        return {
            ok: false,
            error: `no wowaudit roster entry for ${character.name}-${character.realm}`,
        };
    }
    db.update(characters)
        .set({ wowauditId: match.id })
        .where(eq(characters.id, character.id))
        .run();
    return { ok: true, wowauditId: match.id };
}

export type Sleep = (ms: number) => Promise<void>;

const defaultSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export type Uploader = (input: {
    jobId: number;
    reportUrl: string;
    character: Character;
}) => Promise<{ uploaded: boolean }>;

/**
 * Build an uploader that does: resolve-id → pre-fetch wishlist → POST → settle →
 * re-fetch wishlist → require the body to have changed.
 *
 * Why pre/post diff: wowaudit returns 200 OK on POSTs that don't actually update
 * the wishlist (we have an in-the-wild case where a sim ran with stale settings,
 * the report URL was valid, but the wishlist remained unchanged on the server).
 * If the GET body is byte-identical before vs after, treat the upload as failed.
 *
 * Known false-negative: a re-upload of the exact same report data won't change
 * the body and will fail-verify. That's acceptable; it'd only fire on /sim
 * backfill-wowaudit re-runs, which the operator can investigate.
 */
export function makeUploader(
    cfg: WowauditConfig,
    db: Db,
    opts: { fetchFn?: FetchLike; sleep?: Sleep; settleMs?: number } = {},
): Uploader {
    const fetchFn = opts.fetchFn ?? (globalThis.fetch as unknown as FetchLike);
    const sleep = opts.sleep ?? defaultSleep;
    const settleMs = opts.settleMs ?? 1500;

    return async ({ jobId, reportUrl, character }) => {
        const reportId = extractReportId(reportUrl);
        if (!reportId) {
            log.warn({ jobId, reportUrl }, "wowaudit: no report id in url; skipping upload");
            return { uploaded: false };
        }

        const resolved = await resolveWowauditId(cfg, db, character, fetchFn);
        if (!resolved.ok) {
            log.error(
                { jobId, characterId: character.id, error: resolved.error },
                "wowaudit: could not resolve wowaudit character id; skipping upload",
            );
            return { uploaded: false };
        }
        const wowauditId = resolved.wowauditId;

        const before = await getWowauditWishlist(cfg, wowauditId, fetchFn);
        if (!before.ok) {
            log.warn(
                { jobId, wowauditId, error: before.error },
                "wowaudit: pre-upload wishlist fetch failed",
            );
            return { uploaded: false };
        }

        const post = await uploadWishlist(
            cfg,
            { reportId, characterName: character.name, characterId: wowauditId },
            fetchFn,
        );
        if (!post.ok) {
            log.warn({ jobId, reportId, error: post.error }, "wowaudit upload POST failed");
            return { uploaded: false };
        }

        await sleep(settleMs);

        const after = await getWowauditWishlist(cfg, wowauditId, fetchFn);
        if (!after.ok) {
            log.warn(
                { jobId, wowauditId, error: after.error },
                "wowaudit: post-upload verify fetch failed",
            );
            return { uploaded: false };
        }

        if (after.body === before.body) {
            log.error(
                { jobId, reportId, wowauditId, characterName: character.name },
                "wowaudit: POST returned ok but wishlist body did not change — treating as failed",
            );
            return { uploaded: false };
        }

        log.info(
            { jobId, reportId, wowauditId, characterName: character.name },
            "wowaudit upload verified",
        );
        return { uploaded: true };
    };
}
