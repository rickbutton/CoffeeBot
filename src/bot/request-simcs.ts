import type { Client } from "discord.js";
import type { Db } from "../db/client.js";
import {
    listCharacters,
    listKnownDiscordIds,
    listStaleCharacters,
    markCharactersRequested,
} from "../db/repo.js";
import type { Character } from "../db/schema.js";
import { log } from "../util/log.js";
import { getStatusChannelId } from "./status-message.js";

export type RequestMode = "all" | "stale";

export type RequestResult = {
    mode: RequestMode;
    usersDmed: number;
    usersSkipped: number;
    charactersCovered: number;
    neverSubmitted: number;
    stale: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export async function requestSimcs(
    client: Client,
    db: Db,
    mode: RequestMode,
    staleDays: number,
): Promise<RequestResult> {
    const targets = collectTargets(db, mode);
    const statusChannelId = getStatusChannelId(db);
    const result: RequestResult = {
        mode,
        usersDmed: 0,
        usersSkipped: 0,
        charactersCovered: 0,
        neverSubmitted: 0,
        stale: 0,
    };

    for (const [discordId, chars] of targets) {
        if (chars.length === 0) continue;
        try {
            const dm = await (await client.users.fetch(discordId)).createDM();
            await dm.send({
                content: formatDmBody(chars, staleDays, statusChannelId),
                allowedMentions: { parse: [] },
            });
            result.usersDmed++;
            result.charactersCovered += chars.length;
            for (const c of chars) {
                if (c.simc === null) result.neverSubmitted++;
                else result.stale++;
            }
            markCharactersRequested(
                db,
                chars.map((c) => c.id),
            );
        } catch (err) {
            result.usersSkipped++;
            log.warn({ err, discordId }, "requestSimcs: failed to DM user; skipping");
        }
    }

    log.info({ result }, "requestSimcs done");
    return result;
}

function collectTargets(db: Db, mode: RequestMode): Map<string, Character[]> {
    const byOwner = new Map<string, Character[]>();
    if (mode === "all") {
        for (const id of listKnownDiscordIds(db)) byOwner.set(id, listCharacters(db, id));
    } else {
        for (const c of listStaleCharacters(db)) {
            const list = byOwner.get(c.discordId) ?? [];
            list.push(c);
            byOwner.set(c.discordId, list);
        }
    }
    return byOwner;
}

function formatDmBody(
    chars: Character[],
    staleDays: number,
    statusChannelId: string | null,
): string {
    const staleCutoffMs = Date.now() - staleDays * DAY_MS;
    const lines = chars.map((c) => {
        const realm = `${c.realm}-${c.region.toUpperCase()}`;
        const desc = `**${c.name}** *(${c.spec ?? "?"} ${c.className.replace(/_/g, " ")})* — ${realm}`;
        if (c.simc === null) return `  • ${desc} ← never submitted`;
        const updated = c.updatedAt.toISOString().slice(0, 10);
        const reqAt = c.lastRequestedAt?.getTime() ?? 0;
        const flag =
            reqAt > 0 && c.updatedAt.getTime() < reqAt
                ? " ← stale (no update since last ping)"
                : c.updatedAt.getTime() < staleCutoffMs
                  ? ` ← stale (>${staleDays} days old)`
                  : "";
        return `  • ${desc} — updated ${updated}${flag}`;
    });

    const closing = statusChannelId
        ? `To update: in WoW switch to the spec you want, type \`/simc\`, then paste the output into <#${statusChannelId}>. (DMing me here also works as a fallback.)`
        : "To update: in WoW switch to the spec you want, type `/simc`, then paste the output back to me here.";

    return [
        ":crossed_swords: Hi! Time for a simc refresh before the next raid.",
        "Here's what I have on file for you (one row per spec):",
        ...lines,
        "",
        closing,
        "I store one simc per (character, spec) — paste one for each spec you want sim'd. Re-pasting replaces the stored copy for that spec.",
    ].join("\n");
}
