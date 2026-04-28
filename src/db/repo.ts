import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "./client.js";
import { botState, characters, simJobs, users, type Character, type SimJob } from "./schema.js";
import type { SimcCharacter } from "../parser/simc.js";

function ensureUser(db: Db, discordId: string): void {
    db.insert(users).values({ discordId }).onConflictDoNothing({ target: users.discordId }).run();
}

export function upsertCharacter(
    db: Db,
    discordId: string,
    parsed: SimcCharacter,
    rawSimc: string,
): { id: number; created: boolean } {
    ensureUser(db, discordId);
    const existing = db
        .select({ id: characters.id })
        .from(characters)
        .where(
            and(
                eq(characters.discordId, discordId),
                eq(characters.region, parsed.region),
                eq(characters.realm, parsed.realm),
                eq(characters.name, parsed.name),
                parsed.spec === null ? isNull(characters.spec) : eq(characters.spec, parsed.spec),
            ),
        )
        .get();

    if (existing) {
        db.update(characters)
            .set({
                className: parsed.className,
                spec: parsed.spec,
                level: parsed.level,
                race: parsed.race,
                simc: rawSimc,
                updatedAt: new Date(),
            })
            .where(eq(characters.id, existing.id))
            .run();
        return { id: existing.id, created: false };
    }

    const inserted = db
        .insert(characters)
        .values({
            discordId,
            name: parsed.name,
            realm: parsed.realm,
            region: parsed.region,
            className: parsed.className,
            spec: parsed.spec,
            level: parsed.level,
            race: parsed.race,
            simc: rawSimc,
        })
        .returning({ id: characters.id })
        .get();
    return { id: inserted.id, created: true };
}

export function listKnownDiscordIds(db: Db): string[] {
    return db
        .selectDistinct({ discordId: characters.discordId })
        .from(characters)
        .all()
        .map((r) => r.discordId);
}

export function listCharacters(db: Db, discordId: string): Character[] {
    return db.select().from(characters).where(eq(characters.discordId, discordId)).all();
}

export function listAllCharacters(db: Db): Character[] {
    return db
        .select()
        .from(characters)
        .orderBy(characters.discordId, characters.name, characters.spec)
        .all();
}

export function deleteCharacter(db: Db, discordId: string, characterId: number): boolean {
    return (
        db
            .delete(characters)
            .where(and(eq(characters.id, characterId), eq(characters.discordId, discordId)))
            .run().changes > 0
    );
}

export type RosterEntry = {
    discordId: string;
    name: string;
    realm: string;
    region: string;
    className: string;
    specs: string[];
};

export function addCharacterRoster(
    db: Db,
    entry: RosterEntry,
): { inserted: number; alreadyExisted: number } {
    if (entry.specs.length === 0) return { inserted: 0, alreadyExisted: 0 };
    ensureUser(db, entry.discordId);

    const existingSpecs = new Set(
        db
            .select({ spec: characters.spec })
            .from(characters)
            .where(
                and(
                    eq(characters.discordId, entry.discordId),
                    eq(characters.region, entry.region),
                    eq(characters.realm, entry.realm),
                    eq(characters.name, entry.name),
                    inArray(characters.spec, entry.specs),
                ),
            )
            .all()
            .map((r) => r.spec),
    );

    const newSpecs = entry.specs.filter((s) => !existingSpecs.has(s));
    if (newSpecs.length > 0) {
        db.insert(characters)
            .values(
                newSpecs.map((spec) => ({
                    discordId: entry.discordId,
                    name: entry.name,
                    realm: entry.realm,
                    region: entry.region,
                    className: entry.className,
                    spec,
                })),
            )
            .run();
    }
    return { inserted: newSpecs.length, alreadyExisted: existingSpecs.size };
}

export function listStaleCharacters(db: Db): Character[] {
    return db
        .select()
        .from(characters)
        .where(
            or(
                isNull(characters.simc),
                and(
                    sql`${characters.lastRequestedAt} IS NOT NULL`,
                    lt(characters.updatedAt, characters.lastRequestedAt),
                ),
            ),
        )
        .all();
}

export function markCharactersRequested(db: Db, ids: number[]): void {
    if (ids.length === 0) return;
    db.update(characters)
        .set({ lastRequestedAt: new Date() })
        .where(inArray(characters.id, ids))
        .run();
}

export function getCharacterById(db: Db, id: number): Character | null {
    return db.select().from(characters).where(eq(characters.id, id)).get() ?? null;
}

export function latestJobsByCharacter(db: Db): Map<number, SimJob> {
    const rows = db
        .select()
        .from(simJobs)
        .orderBy(sql`${simJobs.id} DESC`)
        .all();
    const map = new Map<number, SimJob>();
    for (const r of rows) if (!map.has(r.characterId)) map.set(r.characterId, r);
    return map;
}

export function getBotState(db: Db, key: string): string | null {
    return (
        db.select({ value: botState.value }).from(botState).where(eq(botState.key, key)).get()
            ?.value ?? null
    );
}

export function setBotState(db: Db, key: string, value: string): void {
    db.insert(botState)
        .values({ key, value })
        .onConflictDoUpdate({ target: botState.key, set: { value, updatedAt: new Date() } })
        .run();
}

export function deleteBotState(db: Db, key: string): void {
    db.delete(botState).where(eq(botState.key, key)).run();
}
