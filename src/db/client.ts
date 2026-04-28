import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as schema from "./schema.js";

export type Db = ReturnType<typeof openDb>;

export function openDb(path: string) {
    if (path !== ":memory:") {
        mkdirSync(dirname(path), { recursive: true });
    }
    const sqlite = new Database(path);
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    return drizzle(sqlite, { schema });
}

export function closeDb(db: Db): void {
    (db as unknown as { $client: Database.Database }).$client.close();
}
