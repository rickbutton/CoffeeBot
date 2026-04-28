import type { Attachment, Message } from "discord.js";
import type { Db } from "../../db/client.js";
import { upsertCharacter } from "../../db/repo.js";
import { looksLikeSimc, parseSimc, type SimcCharacter } from "../../parser/simc.js";
import { log } from "../../util/log.js";

const MAX_ATTACHMENT_BYTES = 1_000_000;

export type SimcOutcome =
    | { kind: "no-content" }
    | { kind: "not-simc" }
    | { kind: "parse-error"; error: string }
    | { kind: "missing-spec" }
    | { kind: "stored"; created: boolean; character: SimcCharacter; rowId: number }
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
        log.info(
            {
                discordId: msg.author.id,
                characterId: result.id,
                created: result.created,
                name: parsed.character.name,
                spec: parsed.character.spec,
            },
            "stored character",
        );
        return {
            kind: "stored",
            created: result.created,
            character: parsed.character,
            rowId: result.id,
        };
    } catch (err) {
        log.error({ err, discordId: msg.author.id }, "failed to store character");
        return { kind: "store-error" };
    }
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
