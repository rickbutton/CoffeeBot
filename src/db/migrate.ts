import "dotenv/config";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { log } from "../util/log.js";
import { openDb } from "./client.js";

const dbPath = process.env.DB_PATH ?? "./data/bot.db";
const db = openDb(dbPath);
log.info({ dbPath }, "applying migrations");
migrate(db, { migrationsFolder: "./drizzle" });
log.info("migrations applied");
