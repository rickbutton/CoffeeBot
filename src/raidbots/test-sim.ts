import "dotenv/config";
import { readFileSync } from "node:fs";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { runDroptimizer } from "./automation.js";
import { RaidbotsSession } from "./session.js";
import { SIM_SETTINGS } from "./settings.js";
import { log } from "../util/log.js";

// Env knobs:
//   PLAYWRIGHT_HEADLESS  shared with the bot
//   WAIT_FOR_COMPLETION  default true; false returns once the report URL is captured
//   SUBMIT               default true; false stops before clicking Run and pauses with the browser open
function envBool(name: string, defaultValue: boolean): boolean {
    const raw = process.env[name];
    if (raw === undefined) return defaultValue;
    return !/^(0|false|no|off)$/i.test(raw.trim());
}

async function main(): Promise<void> {
    const path = process.argv[2];
    if (!path) {
        console.error("Usage: pnpm sim:test-once <path-to-simc-file>");
        process.exit(2);
    }
    const simc = readFileSync(path, "utf8");

    const headless = envBool("PLAYWRIGHT_HEADLESS", true);
    const waitForCompletion = envBool("WAIT_FOR_COMPLETION", true);
    const submitRun = envBool("SUBMIT", true);
    log.info({ headless, waitForCompletion, submitRun }, "test-sim env");

    const session = new RaidbotsSession({
        userDataDir: process.env.PLAYWRIGHT_USER_DATA_DIR ?? "./data/chromium-profile",
        headless,
    });
    const credentials =
        process.env.RAIDBOTS_EMAIL && process.env.RAIDBOTS_PASSWORD
            ? { email: process.env.RAIDBOTS_EMAIL, password: process.env.RAIDBOTS_PASSWORD }
            : null;

    try {
        const result = await runDroptimizer(session, simc, {
            waitForCompletion,
            credentials,
            settings: SIM_SETTINGS,
            submitRun,
        });
        log.info({ result }, "sim run finished");

        if (!submitRun && result.ok) {
            const ctx = await session.getContext();
            const page = ctx.pages().at(-1);
            if (page) {
                const shotPath = "./data/last-test-sim.png";
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

main().catch((err) => {
    log.fatal({ err }, "fatal");
    process.exit(1);
});
