export type PacingConfig = {
    minDelaySeconds: number;
    maxDelaySeconds: number;
    dailyCap: number;
};

export type GateDecision = { gate: "allow" } | { gate: "wait"; reason: string; resumeAtMs: number };

const DAY_MS = 24 * 60 * 60 * 1000;

export function jitterDelayMs(cfg: PacingConfig, rand: () => number = Math.random): number {
    const min = cfg.minDelaySeconds * 1000;
    const max = cfg.maxDelaySeconds * 1000;
    if (max <= min) return min;
    return Math.floor(min + rand() * (max - min));
}

export function utcDayStart(now: Date = new Date()): Date {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function evaluateGate(cfg: PacingConfig, now: Date, doneToday: number): GateDecision {
    if (doneToday >= cfg.dailyCap) {
        return {
            gate: "wait",
            reason: `daily cap reached (${doneToday}/${cfg.dailyCap}); resumes at UTC midnight`,
            resumeAtMs: utcDayStart(new Date(now.getTime() + DAY_MS)).getTime(),
        };
    }
    return { gate: "allow" };
}
