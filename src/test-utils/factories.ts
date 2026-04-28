import { vi } from "vitest";
import type { SimcCharacter } from "../parser/simc.js";
import type { WorkerHandle } from "../queue/worker.js";

export const VALID_SIMC = `# header
hunter="Bowzo"
level=80
race=blood_elf
region=us
server=area-52
spec=beast_mastery
`;

export function sampleCharacter(overrides: Partial<SimcCharacter> = {}): SimcCharacter {
    return {
        className: "hunter",
        classDisplay: "Hunter",
        name: "Bowzo",
        region: "us",
        realm: "area-52",
        spec: "beast_mastery",
        level: 80,
        race: "blood_elf",
        ...overrides,
    } as SimcCharacter;
}

export function makeWorker(overrides: Partial<WorkerHandle> = {}): WorkerHandle {
    return {
        pause: vi.fn(),
        resume: vi.fn(),
        isPaused: () => false,
        poke: vi.fn(),
        stop: async () => {},
        ...overrides,
    };
}

/** Drains pending microtasks. Useful after emitting an event whose handler
 *  is `async`, so subsequent assertions see the handler's effects. */
export async function flushMicrotasks(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

/** vi.fn whose inferred params are `[unknown]` so `.mock.calls[i]![0]` typechecks. */
export const asyncMock = () =>
    vi.fn<(opts: unknown) => Promise<undefined>>(async () => undefined);
