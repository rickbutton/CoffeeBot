import type { Db } from "../db/client.js";
import { getCharacterById } from "../db/repo.js";
import { isHealerSpec } from "../parser/simc.js";
import type { Executor } from "./worker.js";

export type DispatchExecutorOptions = {
    db: Db;
    raidbots: Executor;
    qelive: Executor;
};

// Picks the right tool per job: healer specs go to QELive's Upgrade Finder,
// everything else to Raidbots' droptimizer. Both inner executors get the same
// SimJob; they look up character context themselves if they need it.
export function makeDispatchExecutor(opts: DispatchExecutorOptions): Executor {
    return async (job) => {
        const character = getCharacterById(opts.db, job.characterId);
        if (!character) {
            return { ok: false, error: `dispatch: character ${job.characterId} not found` };
        }
        if (isHealerSpec(character.className, character.spec)) {
            return opts.qelive(job);
        }
        return opts.raidbots(job);
    };
}
