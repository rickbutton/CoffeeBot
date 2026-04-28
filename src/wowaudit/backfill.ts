import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { characters, simJobs, type Character } from "../db/schema.js";
import { markWowauditUploaded } from "../queue/repo.js";
import type { Uploader } from "./upload.js";

export type BackfillResult = {
    /** Successfully POSTed, verified, and stamped. */
    uploaded: number;
    /** Attempted but uploader returned `uploaded: false` (HTTP error / no report id / verify mismatch / unresolved id). */
    failed: number;
    /** Row missing the joined character or report URL — can't even attempt. */
    skipped: number;
};

/**
 * Iterate every `done` job that has a report URL but no `wowauditUploadedAt`
 * timestamp and run it through the uploader. Sequential on purpose — wowaudit's
 * rate limits are unpublished and a guild's worth of toons is small.
 */
export async function backfillWowaudit(db: Db, uploader: Uploader): Promise<BackfillResult> {
    const rows = db
        .select({ job: simJobs, character: characters })
        .from(simJobs)
        .leftJoin(characters, eq(simJobs.characterId, characters.id))
        .where(
            and(
                eq(simJobs.status, "done"),
                isNotNull(simJobs.reportUrl),
                isNull(simJobs.wowauditUploadedAt),
            ),
        )
        .all();

    let uploaded = 0;
    let failed = 0;
    let skipped = 0;
    for (const row of rows) {
        if (!row.job.reportUrl || !row.character) {
            skipped++;
            continue;
        }
        const character: Character = row.character;
        const result = await uploader({
            jobId: row.job.id,
            reportUrl: row.job.reportUrl,
            character,
        });
        if (result.uploaded) {
            markWowauditUploaded(db, row.job.id);
            uploaded++;
        } else {
            failed++;
        }
    }
    return { uploaded, failed, skipped };
}
