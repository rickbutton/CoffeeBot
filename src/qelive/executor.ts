import type { Db } from "../db/client.js";
import { getCharacterById } from "../db/repo.js";
import type { Executor } from "../queue/worker.js";
import { runUpgradeFinder } from "./automation.js";
import { DEFAULT_UPGRADE_FINDER_SETTINGS, qeliveSpecFor } from "./settings.js";
import type { QELiveSession } from "./session.js";

export function makeQELiveExecutor(session: QELiveSession, db: Db): Executor {
    return async (job) => {
        const character = getCharacterById(db, job.characterId);
        if (!character) {
            return { ok: false, error: `qelive: character ${job.characterId} not found` };
        }
        const spec = qeliveSpecFor(character.className, character.spec);
        if (!spec) {
            return {
                ok: false,
                error: `qelive: no healer mapping for ${character.className}/${character.spec ?? "?"}`,
            };
        }
        const result = await runUpgradeFinder(session, job.simcSnapshot, {
            settings: { ...DEFAULT_UPGRADE_FINDER_SETTINGS, spec },
        });
        if (!result.ok) return { ok: false, error: result.error };
        if ("submitted" in result) {
            return { ok: false, error: "qelive: automation returned without submitting" };
        }
        return { ok: true, reportUrl: result.reportUrl };
    };
}
