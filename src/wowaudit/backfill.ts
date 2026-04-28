import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { characters, simJobs } from "../db/schema.js";
import { markWowauditUploaded } from "../queue/repo.js";
import type { Uploader } from "./upload.js";

export type BackfillResult = {
    /** Successfully POSTed and stamped. */
    uploaded: number;
    /** POST attempted but uploader returned `uploaded: false` (HTTP error / no report id). */
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
        .select({
            id: simJobs.id,
            reportUrl: simJobs.reportUrl,
            characterName: characters.name,
        })
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
        if (!row.reportUrl || !row.characterName) {
            skipped++;
            continue;
        }
        const result = await uploader({
            jobId: row.id,
            reportUrl: row.reportUrl,
            characterName: row.characterName,
        });
        if (result.uploaded) {
            markWowauditUploaded(db, row.id);
            uploaded++;
        } else {
            failed++;
        }
    }
    return { uploaded, failed, skipped };
}
