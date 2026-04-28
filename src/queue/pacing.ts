import type { ActiveHours } from "../config.js";

export type PacingConfig = {
    minDelaySeconds: number;
    maxDelaySeconds: number;
    dailyCap: number;
    activeHoursUtc: ActiveHours;
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
    const window = cfg.activeHoursUtc;
    if (window && !hourInWindow(now.getUTCHours(), window)) {
        return {
            gate: "wait",
            reason: `outside active window ${pad(window.startHour)}:00-${pad(window.endHour)}:00 UTC`,
            resumeAtMs: nextActiveStart(now, window).getTime(),
        };
    }
    return { gate: "allow" };
}

// [startHour, endHour) on a 24h clock; wrap-around supported (start=22, end=4 = 22:00–04:00).
function hourInWindow(hour: number, w: { startHour: number; endHour: number }): boolean {
    if (w.startHour === w.endHour) return false;
    if (w.startHour < w.endHour) return hour >= w.startHour && hour < w.endHour;
    return hour >= w.startHour || hour < w.endHour;
}

function nextActiveStart(now: Date, w: { startHour: number; endHour: number }): Date {
    const candidate = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), w.startHour),
    );
    if (candidate.getTime() <= now.getTime()) candidate.setUTCDate(candidate.getUTCDate() + 1);
    return candidate;
}

function pad(n: number): string {
    return n < 10 ? `0${n}` : String(n);
}
