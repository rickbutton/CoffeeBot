import { mkdirSync } from "node:fs";
import { chromium, type BrowserContext } from "playwright";
import { log } from "../util/log.js";

export type RaidbotsSessionOptions = {
    userDataDir: string;
    headless: boolean;
};

// Single persistent Chromium context — cookies, localStorage, and fingerprint stay stable
// across sims so raidbots sees a consistent "human". Concurrency must remain 1.
export class RaidbotsSession {
    private context: BrowserContext | null = null;
    private startup: Promise<BrowserContext> | null = null;

    constructor(private readonly opts: RaidbotsSessionOptions) {
        mkdirSync(opts.userDataDir, { recursive: true });
    }

    async getContext(): Promise<BrowserContext> {
        if (this.context) return this.context;
        if (!this.startup) this.startup = this.launch();
        this.context = await this.startup;
        this.startup = null;
        return this.context;
    }

    private async launch(): Promise<BrowserContext> {
        log.info({ ...this.opts }, "launching persistent chromium");
        return chromium.launchPersistentContext(this.opts.userDataDir, {
            headless: this.opts.headless,
            viewport: { width: 1280, height: 900 },
        });
    }

    async close(): Promise<void> {
        if (!this.context) return;
        await this.context
            .close()
            .catch((err) => log.warn({ err }, "error closing chromium context"));
        this.context = null;
    }
}
