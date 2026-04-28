import "dotenv/config";
import { readFileSync } from "node:fs";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { parseSimc } from "../parser/simc.js";
import { log } from "../util/log.js";
import { runUpgradeFinder } from "./automation.js";
import { QELiveSession } from "./session.js";
import {
    DEFAULT_UPGRADE_FINDER_SETTINGS,
    qeliveSpecFor,
    type QELiveSpec,
} from "./settings.js";

// Env knobs:
//   PLAYWRIGHT_HEADLESS    shared with the bot
//   SUBMIT                 default true; false stops before clicking Go! and pauses with the browser open
//   QELIVE_SPEC            optional override (e.g. "Restoration Shaman") if the simc class/spec lookup fails
function envBool(name: string, defaultValue: boolean): boolean {
    const raw = process.env[name];
    if (raw === undefined) return defaultValue;
    return !/^(0|false|no|off)$/i.test(raw.trim());
}

async function main(): Promise<void> {
    const path = process.argv[2];
    if (!path) {
        console.error("Usage: pnpm qelive:test-once <path-to-simc-file>");
        process.exit(2);
    }
    const simc = readFileSync(path, "utf8");

    const spec = resolveSpec(simc);
    if (!spec) {
        console.error(
            "Could not resolve a QELive healer spec from the simc. " +
                'Set QELIVE_SPEC="Restoration Shaman" (or similar) and retry.',
        );
        process.exit(2);
    }

    const headless = envBool("PLAYWRIGHT_HEADLESS", true);
    const submitRun = envBool("SUBMIT", true);
    log.info({ headless, submitRun, spec }, "qelive test-sim env");

    const session = new QELiveSession({
        userDataDir: process.env.QELIVE_USER_DATA_DIR ?? "./data/qelive-profile",
        headless,
    });

    try {
        const result = await runUpgradeFinder(session, simc, {
            settings: { ...DEFAULT_UPGRADE_FINDER_SETTINGS, spec },
            submitRun,
        });
        log.info({ result }, "qelive run finished");

        if (!submitRun && result.ok) {
            const ctx = await session.getContext();
            const page = ctx.pages().at(-1);
            if (page) {
                const shotPath = "./data/last-qelive-test.png";
                await page.screenshot({ path: shotPath, fullPage: true }).catch((err) => {
                    log.warn({ err }, "failed to capture screenshot");
                });
                console.log(`\n📸 Screenshot saved: ${shotPath}`);
            }
            const rl = createInterface({ input: stdin, output: stdout });
            console.log(
                "✋ The browser is open with the form configured. Inspect it, then press ENTER to close.",
            );
            await rl.question("");
            rl.close();
        }

        if (!result.ok) process.exit(1);
    } finally {
        await session.close();
    }
}

function resolveSpec(simc: string): QELiveSpec | null {
    const override = process.env.QELIVE_SPEC as QELiveSpec | undefined;
    if (override) return override;
    const parsed = parseSimc(simc);
    if (!parsed.ok) return null;
    return qeliveSpecFor(parsed.character.className, parsed.character.spec);
}

main().catch((err) => {
    log.fatal({ err }, "fatal");
    process.exit(1);
});
