import type { Attachment, Message } from "discord.js";
import type { Db } from "../../db/client.js";
import { upsertCharacter } from "../../db/repo.js";
import { looksLikeSimc, parseSimc, type SimcCharacter } from "../../parser/simc.js";
import { enqueueForCharacter, type EnqueueResult } from "../../queue/repo.js";
import { log } from "../../util/log.js";

const MAX_ATTACHMENT_BYTES = 1_000_000;

export type SimcOutcome =
    | { kind: "no-content" }
    | { kind: "not-simc" }
    | { kind: "parse-error"; error: string }
    | { kind: "missing-spec" }
    | {
          kind: "stored";
          created: boolean;
          character: SimcCharacter;
          rowId: number;
          enqueue: EnqueueResult;
      }
    | { kind: "store-error" };

export async function processSimcMessage(db: Db, msg: Message): Promise<SimcOutcome> {
    const text = await resolveSimcText(msg);
    if (text === null) return { kind: "no-content" };
    if (!looksLikeSimc(text)) return { kind: "not-simc" };

    const parsed = parseSimc(text);
    if (!parsed.ok) return { kind: "parse-error", error: parsed.error };
    if (!parsed.character.spec) return { kind: "missing-spec" };

    try {
        const result = upsertCharacter(db, msg.author.id, parsed.character, text);
        const enqueue = enqueueForCharacter(db, result.id);
        log.info(
            {
                discordId: msg.author.id,
                characterId: result.id,
                created: result.created,
                name: parsed.character.name,
                spec: parsed.character.spec,
                enqueued: enqueue.enqueued,
                skippedHealer: enqueue.skippedHealer,
                skippedDuplicate: enqueue.skippedDuplicate,
            },
            "stored character",
        );
        return {
            kind: "stored",
            created: result.created,
            character: parsed.character,
            rowId: result.id,
            enqueue,
        };
    } catch (err) {
        log.error({ err, discordId: msg.author.id }, "failed to store character");
        return { kind: "store-error" };
    }
}

export function enqueueSuffix(r: EnqueueResult): string {
    if (r.enqueued > 0) return " :gear: Sim queued.";
    if (r.skippedDuplicate > 0) return " (Already simmed this exact simc — skipping.)";
    if (r.skippedHealer > 0) return " (Healer spec — sim manually in QELive.)";
    return "";
}

async function resolveSimcText(msg: Message): Promise<string | null> {
    if (msg.content.trim().length > 0) return msg.content;
    for (const a of msg.attachments.values()) {
        const text = await fetchAttachmentText(a);
        if (text !== null) return text;
    }
    return null;
}

async function fetchAttachmentText(a: Attachment): Promise<string | null> {
    if (a.size > MAX_ATTACHMENT_BYTES) {
        log.warn({ name: a.name, size: a.size }, "attachment too large to fetch");
        return null;
    }
    if (!isPlausibleTextAttachment(a)) return null;
    try {
        const res = await fetch(a.url);
        if (!res.ok) return null;
        return await res.text();
    } catch (err) {
        log.error({ err, name: a.name }, "error fetching attachment");
        return null;
    }
}

// Discord often omits contentType for unknown extensions — trust the name in that case.
function isPlausibleTextAttachment(a: Attachment): boolean {
    const ct = a.contentType?.toLowerCase() ?? "";
    if (ct.startsWith("text/")) return true;
    if (ct === "" || ct === "application/octet-stream") {
        const name = (a.name ?? "").toLowerCase();
        return name.endsWith(".txt") || name.endsWith(".simc") || name === "message.txt";
    }
    return false;
}
