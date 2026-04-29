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
import { groupBy, truncate } from "../util/format.js";
import { log } from "../util/log.js";

const KEY_CHANNEL = "status_channel_id";
const KEY_MESSAGE_LEGACY = "status_message_id"; // pre-pagination — single id; read-fallback only.
const KEY_MESSAGE_IDS = "status_message_ids"; // JSON-encoded string[] of ordered page message ids.
const DAY_MS = 24 * 60 * 60 * 1000;

// Per-page char budget for the embed description. Discord's hard cap is 4096; we leave
// headroom and apply truncate(4000) as a final safety net per page.
const PAGE_BUDGET = 3800;

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

export function getStatusMessageIds(db: Db): string[] {
    const raw = getBotState(db, KEY_MESSAGE_IDS);
    if (raw) {
        try {
            const parsed: unknown = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
                return parsed as string[];
            }
        } catch {
            // fall through to legacy
        }
    }
    const legacy = getBotState(db, KEY_MESSAGE_LEGACY);
    return legacy ? [legacy] : [];
}

export function setStatusMessageIds(db: Db, ids: string[]): void {
    setBotState(db, KEY_MESSAGE_IDS, JSON.stringify(ids));
    // Keep the legacy key from confusing future reads.
    deleteBotState(db, KEY_MESSAGE_LEGACY);
}

export function setStatusChannel(db: Db, channelId: string, messageIds: string[]): void {
    setBotState(db, KEY_CHANNEL, channelId);
    setStatusMessageIds(db, messageIds);
}

export function clearStatusChannel(db: Db): void {
    deleteBotState(db, KEY_CHANNEL);
    deleteBotState(db, KEY_MESSAGE_IDS);
    deleteBotState(db, KEY_MESSAGE_LEGACY);
}

type PageContext = {
    color: number;
    footerText: string;
    totalPages: number;
};

/**
 * Render the roster as one or more embeds, each fitting under Discord's per-embed limits.
 * Returns at least one embed even for an empty roster.
 *
 * Pagination rules:
 *  - Owner blocks (one mention plus all that owner's character lines) are atomic and never
 *    split across pages.
 *  - First page carries the INSTRUCTIONS header.
 *  - Last page carries the totals footer + timestamp.
 *  - When >1 page, the title becomes "Droptimizer Reports (i/N)" so channel scroll reads cleanly.
 */
export function renderStatusPages(db: Db, staleDays: number): EmbedBuilder[] {
    const all = listAllCharacters(db);
    const latestJobs = latestJobsByCharacter(db);
    const byOwner = groupBy(all, (c) => c.discordId);
    const ownerIds = [...byOwner.keys()].sort();

    let fresh = 0;
    let stale = 0;
    let missing = 0;
    for (const c of all) {
        if (c.simc === null) missing++;
        else if (isStale(c, staleDays)) stale++;
        else fresh++;
    }
    const ctx: PageContext = {
        color: missing > 0 || stale > 0 ? 0xffaa00 : 0x33cc66,
        footerText: `${all.length} character/spec(s) · ✅ ${fresh} fresh · ⚠️ ${stale} stale · 🔴 ${missing} not yet submitted`,
        totalPages: 0, // filled in below
    };

    if (ownerIds.length === 0) {
        ctx.totalPages = 1;
        return [
            buildEmbed(
                "_No characters registered yet. Use `/characters register` to add some._",
                { ...ctx, totalPages: 1 },
                /* index */ 0,
                /* isFirst */ true,
                /* isLast */ true,
            ),
        ];
    }

    const ownerBlocks = ownerIds.map(
        (id) =>
            `<@${id}>\n${byOwner
                .get(id)!
                .map((c) => formatLine(c, staleDays, latestJobs.get(c.id)))
                .join("\n")}`,
    );

    const pages: string[][] = [[]];
    let pageBytes = INSTRUCTIONS.length + 1; // first page reserves space for header
    for (const block of ownerBlocks) {
        const cost = block.length + 2; // approximate "\n\n" separator
        const isFirstOnPage = pages[pages.length - 1]!.length === 0;
        if (!isFirstOnPage && pageBytes + cost > PAGE_BUDGET) {
            pages.push([]);
            pageBytes = 0;
        }
        pages[pages.length - 1]!.push(block);
        pageBytes += cost;
    }

    ctx.totalPages = pages.length;
    return pages.map((blocks, i) => {
        const isFirst = i === 0;
        const isLast = i === pages.length - 1;
        const body = blocks.join("\n\n");
        const desc = isFirst ? `${INSTRUCTIONS}\n${body}` : body;
        return buildEmbed(desc, ctx, i, isFirst, isLast);
    });
}

function buildEmbed(
    description: string,
    ctx: PageContext,
    index: number,
    isFirst: boolean,
    isLast: boolean,
): EmbedBuilder {
    const title =
        ctx.totalPages > 1
            ? `Droptimizer Reports (${index + 1}/${ctx.totalPages})`
            : "Droptimizer Reports";
    const e = new EmbedBuilder()
        .setTitle(title)
        .setDescription(truncate(description, 4000))
        .setColor(ctx.color);
    if (isLast) e.setFooter({ text: ctx.footerText }).setTimestamp(new Date());
    // isFirst is implicit in the description (INSTRUCTIONS at top); no extra branding needed.
    void isFirst;
    return e;
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
            if (!job.reportUrl) return " · sim: done";
            const outdated =
                c.simc !== null && c.updatedAt.getTime() > (job.completedAt?.getTime() ?? 0);
            const link = `[report](${job.reportUrl})`;
            return outdated ? ` · sim: ${link} ⚠ simc updated since` : ` · sim: ${link}`;
        }
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
    const ids = getStatusMessageIds(db);

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) {
        log.warn({ channelId }, "status: channel missing or not guild text");
        return;
    }
    const tc = channel as TextChannel;
    const embeds = renderStatusPages(db, staleDays);
    let surviving: string[] = [];

    // (1) Edit-in-place for the slots we have message ids for.
    const editLimit = Math.min(ids.length, embeds.length);
    let editedCount = 0;
    for (let i = 0; i < editLimit; i++) {
        try {
            const msg = await tc.messages.fetch(ids[i]!);
            await msg.edit({ embeds: [embeds[i]!] });
            surviving.push(ids[i]!);
            editedCount++;
        } catch {
            log.warn({ messageId: ids[i] }, "status: stored message gone; will repost from here");
            // Stop editing — order is significant. The remaining slots get fresh posts in step 2.
            break;
        }
    }

    // (2) Post any pages we don't have messages for. Persist incrementally so a crash or rate
    //     limit mid-loop leaves a coherent state for the next debounced run.
    for (let i = editedCount; i < embeds.length; i++) {
        const posted = await tc.send({ embeds: [embeds[i]!] }).catch((err) => {
            log.error({ err, channelId, pageIndex: i }, "status: failed to post page");
            return null;
        });
        if (!posted) {
            setStatusMessageIds(db, surviving);
            return;
        }
        surviving.push(posted.id);
        setStatusMessageIds(db, surviving);
    }

    // (3) Delete obsolete trailing messages we no longer need.
    const obsolete = ids.slice(editedCount).filter((id) => !surviving.includes(id));
    for (const id of obsolete) {
        await tc.messages
            .fetch(id)
            .then((m) => m.delete())
            .catch(() => {});
    }

    setStatusMessageIds(db, surviving);
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
