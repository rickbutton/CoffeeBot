import { log } from "../util/log.js";

export type WowauditConfig = {
    apiKey: string;
    baseUrl: string;
};

export type WowauditUploadInput = {
    reportId: string;
    characterName: string;
};

export type WowauditUploadResult = { ok: true } | { ok: false; error: string };

const REPORT_ID_RE = /\/simbot\/report\/([A-Za-z0-9_-]+)/;

export function extractReportId(reportUrl: string): string | null {
    const m = reportUrl.match(REPORT_ID_RE);
    return m ? (m[1] ?? null) : null;
}

export type FetchLike = (
    url: string,
    init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/**
 * POST /v1/wishlists — uploads a Raidbots droptimizer report to wowaudit.
 * The team is identified by the API key alone; no team_id needed.
 *
 * character_id is omitted on purpose — the swagger example shows it but we don't
 * have wowaudit's internal id for our players. If it turns out to be required,
 * we'll need a `GET /v1/characters` lookup pass; for now we send character_name
 * and hope the server resolves it.
 */
export async function uploadWishlist(
    cfg: WowauditConfig,
    input: WowauditUploadInput,
    fetchFn: FetchLike,
): Promise<WowauditUploadResult> {
    const url = `${cfg.baseUrl.replace(/\/+$/, "")}/v1/wishlists`;
    try {
        const res = await fetchFn(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${cfg.apiKey}`,
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            body: JSON.stringify({
                report_id: input.reportId,
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
 * Bound uploader — composes URL extraction, upload, and a uniform
 * "skip silently / log on failure / report success" contract for the worker.
 */
export type Uploader = (input: {
    jobId: number;
    reportUrl: string;
    characterName: string;
}) => Promise<{ uploaded: boolean }>;

export function makeUploader(
    cfg: WowauditConfig,
    fetchFn: FetchLike = globalThis.fetch as unknown as FetchLike,
): Uploader {
    return async ({ jobId, reportUrl, characterName }) => {
        const reportId = extractReportId(reportUrl);
        if (!reportId) {
            log.warn({ jobId, reportUrl }, "wowaudit: no report id in url; skipping upload");
            return { uploaded: false };
        }
        const result = await uploadWishlist(cfg, { reportId, characterName }, fetchFn);
        if (!result.ok) {
            log.warn({ jobId, reportId, error: result.error }, "wowaudit upload failed");
            return { uploaded: false };
        }
        log.info({ jobId, reportId, characterName }, "wowaudit upload ok");
        return { uploaded: true };
    };
}
