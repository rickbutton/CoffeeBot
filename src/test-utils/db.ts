import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { openDb, type Db } from "../db/client.js";

const MIGRATIONS_FOLDER = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "drizzle",
);

export function makeTestDb(): Db {
    const db = openDb(":memory:");
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    return db;
}
