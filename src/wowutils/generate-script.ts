import "dotenv/config";
import { stdin, stdout, stderr } from "node:process";
import { createInterface } from "node:readline/promises";
import { closeDb, openDb } from "../db/client.js";
import { runScriptGenerator, type IO } from "./cli.js";

const DB_PATH = process.env.DB_PATH ?? "./data/bot.db";
const PREFS_PATH = "./data/wowutils-spec-preferences.json";
const SCRIPT_PATH = "./data/wowutils-script.js";

async function main(): Promise<void> {
    const db = openDb(DB_PATH);
    const rl = createInterface({ input: stdin, output: stdout });

    const io: IO = {
        info: (msg) => stderr.write(msg + "\n"),
        promptSpec: async (group) => {
            const lines: string[] = [
                "",
                `${group.characterName} (${group.region.toUpperCase()} · ${group.realm}) has ${group.options.length} specs simmed:`,
                ...group.options.map(
                    (opt, i) => `  ${i + 1}) ${opt.specDisplay}  →  ${opt.reportUrl}`,
                ),
                `  s) skip`,
            ];
            stderr.write(lines.join("\n") + "\n");
            for (;;) {
                const raw = (await rl.question("Choose [1..n / s]: ")).trim().toLowerCase();
                if (raw === "s" || raw === "skip") return null;
                const n = Number.parseInt(raw, 10);
                if (Number.isFinite(n) && n >= 1 && n <= group.options.length) {
                    return group.options[n - 1]!.spec;
                }
                stderr.write("Not a valid choice.\n");
            }
        },
    };

    try {
        const result = await runScriptGenerator({
            db,
            prefsPath: PREFS_PATH,
            scriptPath: SCRIPT_PATH,
            io,
        });
        stderr.write(
            `\nDone. ${result.ready.length} character(s) ready. Open ${result.scriptPath}, copy its contents, and paste into the devtools console on the wowutils Loot Wishlist > Droptimizers tab.\n`,
        );
    } finally {
        rl.close();
        closeDb(db);
    }
}

main().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    stderr.write(`fatal: ${msg}\n`);
    process.exit(1);
});
