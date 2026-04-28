import { describe, expect, it, vi } from "vitest";
import { upsertCharacter } from "../db/repo.js";
import type { SimJob } from "../db/schema.js";
import { sampleCharacter as sample } from "../test-utils/factories.js";
import { makeTestDb } from "../test-utils/db.js";
import { makeQELiveExecutor } from "./executor.js";

vi.mock("./automation.js", () => ({
    runUpgradeFinder: vi.fn(),
}));

import { runUpgradeFinder } from "./automation.js";

const fakeSession = {} as never;

function jobFor(characterId: number): SimJob {
    return {
        id: 1,
        characterId,
        status: "running",
        simcSnapshot: 'priest="Healz"',
        reportUrl: null,
        error: null,
        createdAt: new Date(),
        startedAt: new Date(),
        completedAt: null,
        wowauditUploadedAt: null,
    };
}

describe("makeQELiveExecutor", () => {
    it("invokes runUpgradeFinder with the mapped spec and returns the report URL", async () => {
        const db = makeTestDb();
        const c = upsertCharacter(
            db,
            "u1",
            sample({ name: "Healz", className: "priest", spec: "discipline" }),
            "raw",
        );
        vi.mocked(runUpgradeFinder).mockResolvedValueOnce({
            ok: true,
            reportUrl: "https://questionablyepic.com/live/upgradereport/abc123",
            reportId: "abc123",
        });
        const exec = makeQELiveExecutor(fakeSession, db);
        const r = await exec(jobFor(c.id));
        expect(r).toEqual({
            ok: true,
            reportUrl: "https://questionablyepic.com/live/upgradereport/abc123",
        });
        const callArgs = vi.mocked(runUpgradeFinder).mock.calls[0]![2];
        expect(callArgs.settings.spec).toBe("Discipline Priest");
    });

    it("returns failure when the character row is missing", async () => {
        const db = makeTestDb();
        const exec = makeQELiveExecutor(fakeSession, db);
        const r = await exec(jobFor(9999));
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.error).toMatch(/character 9999 not found/);
    });

    it("returns failure when the character isn't a healer spec", async () => {
        const db = makeTestDb();
        const c = upsertCharacter(
            db,
            "u1",
            sample({ name: "Bow", className: "hunter", spec: "marksmanship" }),
            "raw",
        );
        const exec = makeQELiveExecutor(fakeSession, db);
        const r = await exec(jobFor(c.id));
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.error).toMatch(/no healer mapping/);
    });

    it("propagates automation failures", async () => {
        const db = makeTestDb();
        const c = upsertCharacter(
            db,
            "u1",
            sample({ name: "Healz", className: "priest", spec: "discipline" }),
            "raw",
        );
        vi.mocked(runUpgradeFinder).mockResolvedValueOnce({ ok: false, error: "timeout" });
        const exec = makeQELiveExecutor(fakeSession, db);
        const r = await exec(jobFor(c.id));
        expect(r).toEqual({ ok: false, error: "timeout" });
    });

    it("treats submitted:false as failure (we never run that path through the queue)", async () => {
        const db = makeTestDb();
        const c = upsertCharacter(
            db,
            "u1",
            sample({ name: "Healz", className: "priest", spec: "discipline" }),
            "raw",
        );
        vi.mocked(runUpgradeFinder).mockResolvedValueOnce({ ok: true, submitted: false });
        const exec = makeQELiveExecutor(fakeSession, db);
        const r = await exec(jobFor(c.id));
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.error).toMatch(/without submitting/);
    });
});
