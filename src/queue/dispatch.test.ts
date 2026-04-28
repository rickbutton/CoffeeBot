import { describe, expect, it, vi } from "vitest";
import { upsertCharacter } from "../db/repo.js";
import type { SimJob } from "../db/schema.js";
import { sampleCharacter as sample } from "../test-utils/factories.js";
import { makeTestDb } from "../test-utils/db.js";
import { makeDispatchExecutor } from "./dispatch.js";

function jobFor(characterId: number): SimJob {
    return {
        id: 1,
        characterId,
        status: "running",
        simcSnapshot: "x",
        reportUrl: null,
        error: null,
        createdAt: new Date(),
        startedAt: new Date(),
        completedAt: null,
        wowauditUploadedAt: null,
    };
}

describe("makeDispatchExecutor", () => {
    it("routes healer specs to the qelive executor", async () => {
        const db = makeTestDb();
        const c = upsertCharacter(
            db,
            "u1",
            sample({ name: "Healz", className: "priest", spec: "discipline" }),
            "raw",
        );
        const raidbots = vi.fn(async () => ({ ok: true, reportUrl: "rb" }) as const);
        const qelive = vi.fn(async () => ({ ok: true, reportUrl: "qe" }) as const);
        const dispatch = makeDispatchExecutor({ db, raidbots, qelive });
        const r = await dispatch(jobFor(c.id));
        expect(r).toEqual({ ok: true, reportUrl: "qe" });
        expect(qelive).toHaveBeenCalledOnce();
        expect(raidbots).not.toHaveBeenCalled();
    });

    it("routes non-healer specs to the raidbots executor", async () => {
        const db = makeTestDb();
        const c = upsertCharacter(
            db,
            "u1",
            sample({ name: "Bow", className: "hunter", spec: "marksmanship" }),
            "raw",
        );
        const raidbots = vi.fn(async () => ({ ok: true, reportUrl: "rb" }) as const);
        const qelive = vi.fn(async () => ({ ok: true, reportUrl: "qe" }) as const);
        const dispatch = makeDispatchExecutor({ db, raidbots, qelive });
        const r = await dispatch(jobFor(c.id));
        expect(r).toEqual({ ok: true, reportUrl: "rb" });
        expect(raidbots).toHaveBeenCalledOnce();
        expect(qelive).not.toHaveBeenCalled();
    });

    it("returns failure when the character row is missing", async () => {
        const db = makeTestDb();
        const raidbots = vi.fn();
        const qelive = vi.fn();
        const dispatch = makeDispatchExecutor({ db, raidbots, qelive });
        const r = await dispatch(jobFor(9999));
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.error).toMatch(/character 9999 not found/);
        expect(raidbots).not.toHaveBeenCalled();
        expect(qelive).not.toHaveBeenCalled();
    });
});
