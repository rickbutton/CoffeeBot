import type { Executor } from "../queue/worker.js";
import { runDroptimizer } from "./automation.js";
import type { LoginCredentials } from "./login.js";
import type { RaidbotsSession } from "./session.js";

export function makeRaidbotsExecutor(
    session: RaidbotsSession,
    credentials: LoginCredentials | null,
): Executor {
    return async (job) => {
        const result = await runDroptimizer(session, job.simcSnapshot, {
            waitForCompletion: true,
            credentials,
        });
        if (!result.ok) return { ok: false, error: result.error };
        if ("submitted" in result)
            return { ok: false, error: "automation returned without submitting" };
        return { ok: true, reportUrl: result.reportUrl };
    };
}
