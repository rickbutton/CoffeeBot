import { ChannelType, type Client, EmbedBuilder, type TextChannel } from "discord.js";
import type { Db } from "../db/client.js";
import {
    deleteBotState,
    getBotState,
    latestJobsByCharacter,
    listAllCharacters,
    setBotState,
} from "../db/repo.js";
import type { Character, SimJob } from "../db/schema.js";
import { log } from "../util/log.js";

const KEY_CHANNEL = "status_channel_id";
const KEY_MESSAGE = "status_message_id";
const DAY_MS = 24 * 60 * 60 * 1000;
const INSTRUCTIONS = [
    "**How this channel works**",
    "• Paste your in-game `/simc` output here. I'll react :white_check_mark:, clean up your message, and update this report.",
    "• One simc per `(character, spec)` — switch specs in WoW and re-run `/simc` for each.",
    "• Re-pasting replaces the stored copy. Status icons: :white_check_mark: fresh · :warning: stale · :red_circle: not submitted yet.",
    "",
    "**Roster**",
].join("\n");

export function getStatusChannelId(db: Db): string | null {
    return getBotState(db, KEY_CHANNEL);
}

export function setStatusChannel(db: Db, channelId: string, messageId: string): void {
    setBotState(db, KEY_CHANNEL, channelId);
    setBotState(db, KEY_MESSAGE, messageId);
}

export function clearStatusChannel(db: Db): void {
    deleteBotState(db, KEY_CHANNEL);
    deleteBotState(db, KEY_MESSAGE);
}

export function renderStatusEmbed(db: Db, staleDays: number): EmbedBuilder {
    const all = listAllCharacters(db);
    const latestJobs = latestJobsByCharacter(db);
    const byOwner = groupBy(all, (c) => c.discordId);
    const ownerIds = [...byOwner.keys()].sort();

    const fresh = all.filter((c) => c.simc !== null && !isStale(c, staleDays)).length;
    const stale = all.filter((c) => c.simc !== null && isStale(c, staleDays)).length;
    const missing = all.filter((c) => c.simc === null).length;

    const roster =
        ownerIds.length === 0
            ? "_No characters registered yet. Use `/characters register` to add some._"
            : ownerIds
                  .map(
                      (id) =>
                          `<@${id}>\n${byOwner
                              .get(id)!
                              .map((c) => formatLine(c, staleDays, latestJobs.get(c.id)))
                              .join("\n")}`,
                  )
                  .join("\n\n");

    return new EmbedBuilder()
        .setTitle("Droptimizer Reports")
        .setDescription(truncate(`${INSTRUCTIONS}\n${roster}`, 4000))
        .setColor(missing > 0 || stale > 0 ? 0xffaa00 : 0x33cc66)
        .setFooter({
            text: `${all.length} character/spec(s) · ✅ ${fresh} fresh · ⚠️ ${stale} stale · 🔴 ${missing} not yet submitted`,
        })
        .setTimestamp(new Date());
}

function formatLine(c: Character, staleDays: number, job: SimJob | undefined): string {
    const head = `**${c.name}** *(${c.spec ?? "?"})*`;
    const sim = formatSimStatus(c, job);
    if (c.simc === null) return `:red_circle: ${head} — _never submitted_${sim}`;
    const updated = `<t:${Math.floor(c.updatedAt.getTime() / 1000)}:R>`;
    if (isStale(c, staleDays)) {
        const reason = staleByRequest(c) ? "no update since last ping" : `>${staleDays}d old`;
        return `:warning: ${head} — updated ${updated} _(${reason})_${sim}`;
    }
    return `:white_check_mark: ${head} — updated ${updated}${sim}`;
}

function formatSimStatus(c: Character, job: SimJob | undefined): string {
    if (!job) return "";
    switch (job.status) {
        case "queued":
            return " · sim: ⏳ queued";
        case "running":
            return " · sim: ⏳ running";
        case "cancelled":
            return " · sim: ⊘ cancelled";
        case "failed":
            return ` · sim: ❌ failed${job.error ? ` (${truncate(job.error, 60)})` : ""}`;
        case "done": {
            if (!job.raidbotsUrl) return " · sim: done";
            const outdated =
                c.simc !== null && c.updatedAt.getTime() > (job.completedAt?.getTime() ?? 0);
            const link = `[report](${job.raidbotsUrl})`;
            return outdated ? ` · sim: ${link} ⚠ simc updated since` : ` · sim: ${link}`;
        }
        default:
            return ` · sim: ${job.status}`;
    }
}

function isStale(c: Character, staleDays: number): boolean {
    if (c.simc === null) return false;
    if (staleByRequest(c)) return true;
    return Date.now() - c.updatedAt.getTime() > staleDays * DAY_MS;
}

function staleByRequest(c: Character): boolean {
    return c.lastRequestedAt !== null && c.updatedAt.getTime() < c.lastRequestedAt.getTime();
}

export async function updateStatusMessage(
    client: Client,
    db: Db,
    staleDays: number,
): Promise<void> {
    const channelId = getBotState(db, KEY_CHANNEL);
    if (!channelId) return;
    const messageId = getBotState(db, KEY_MESSAGE);

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) {
        log.warn({ channelId }, "status: channel missing or not guild text");
        return;
    }
    const tc = channel as TextChannel;
    const embed = renderStatusEmbed(db, staleDays);

    if (messageId) {
        try {
            const msg = await tc.messages.fetch(messageId);
            await msg.edit({ embeds: [embed] });
            return;
        } catch {
            log.warn({ messageId }, "status: stored message gone; reposting");
        }
    }

    const posted = await tc.send({ embeds: [embed] }).catch((err) => {
        log.error({ err, channelId }, "status: failed to post");
        return null;
    });
    if (posted) setBotState(db, KEY_MESSAGE, posted.id);
}

export function makeStatusUpdater(client: Client, db: Db, staleDays: number): () => void {
    let pending: NodeJS.Timeout | null = null;
    return () => {
        if (pending) return;
        pending = setTimeout(() => {
            pending = null;
            updateStatusMessage(client, db, staleDays).catch((err) =>
                log.error({ err }, "status: update failed"),
            );
        }, 1500);
    };
}

function groupBy<T, K>(arr: T[], key: (t: T) => K): Map<K, T[]> {
    const out = new Map<K, T[]>();
    for (const item of arr) {
        const list = out.get(key(item)) ?? [];
        list.push(item);
        out.set(key(item), list);
    }
    return out;
}

function truncate(s: string, n: number): string {
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
