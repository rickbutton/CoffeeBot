import "dotenv/config";
import { stderr } from "node:process";
import { eq } from "drizzle-orm";
import { closeDb, openDb } from "../db/client.js";
import { characters, simJobs } from "../db/schema.js";
import { loadConfig } from "../config.js";
import { log } from "../util/log.js";
import { makeUploader } from "./upload.js";

// Manual test driver: runs the wowaudit upload+verify flow for a single sim job.
// Intended for use against a local copy of the prod DB (`pnpm db:pull-prod`).
// Hits the real wowaudit API.

async function main(): Promise<void> {
    const arg = process.argv[2];
    if (!arg) {
        stderr.write("Usage: pnpm wowaudit:test <jobId>\n");
        process.exit(2);
    }
    const jobId = Number.parseInt(arg, 10);
    if (!Number.isFinite(jobId)) {
        stderr.write(`Not a numeric jobId: ${arg}\n`);
        process.exit(2);
    }

    const config = loadConfig();
    if (!config.wowaudit) {
        stderr.write("WOWAUDIT_API_KEY is not set in .env\n");
        process.exit(2);
    }

    const db = openDb(config.dbPath);
    try {
        const row = db
            .select({ job: simJobs, character: characters })
            .from(simJobs)
            .leftJoin(characters, eq(simJobs.characterId, characters.id))
            .where(eq(simJobs.id, jobId))
            .get();
        if (!row) {
            stderr.write(`Job ${jobId} not found in ${config.dbPath}\n`);
            process.exit(1);
        }
        if (!row.character) {
            stderr.write(`Job ${jobId}'s character row is missing\n`);
            process.exit(1);
        }
        if (!row.job.reportUrl) {
            stderr.write(`Job ${jobId} has no reportUrl yet\n`);
            process.exit(1);
        }

        log.info(
            {
                jobId,
                character: row.character.name,
                realm: row.character.realm,
                cachedWowauditId: row.character.wowauditId,
                reportUrl: row.job.reportUrl,
                wowauditUploadedAt: row.job.wowauditUploadedAt,
            },
            "starting wowaudit upload+verify",
        );

        const uploader = makeUploader(config.wowaudit, db);
        const result = await uploader({
            jobId: row.job.id,
            reportUrl: row.job.reportUrl,
            character: row.character,
        });
        log.info({ result }, "uploader returned");
        if (!result.uploaded) process.exit(1);
    } finally {
        closeDb(db);
    }
}

main().catch((err: unknown) => {
    log.fatal({ err }, "fatal");
    process.exit(1);
});
