import { CronJob } from "cron";
import { type Client, Events } from "discord.js";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createClient } from "./bot/client.js";
import { registerChannelHandler } from "./bot/handlers/channel.js";
import { registerDmHandler } from "./bot/handlers/dm.js";
import { registerInteractionHandler } from "./bot/handlers/interactions.js";
import { notifyAdmins } from "./bot/notify.js";
import { registerCommands } from "./bot/register-commands.js";
import { requestSimcs } from "./bot/request-simcs.js";
import { makeStatusUpdater, updateStatusMessage } from "./bot/status-message.js";
import { loadConfig } from "./config.js";
import { openDb } from "./db/client.js";
import { getCharacterById, listKnownDiscordIds } from "./db/repo.js";
import { makeDispatchExecutor } from "./queue/dispatch.js";
import { markWowauditUploaded } from "./queue/repo.js";
import { startWorker, stubExecutor, type Executor } from "./queue/worker.js";
import { makeQELiveExecutor } from "./qelive/executor.js";
import { QELiveSession } from "./qelive/session.js";
import { makeRaidbotsExecutor } from "./raidbots/executor.js";
import { RaidbotsSession } from "./raidbots/session.js";
import { log } from "./util/log.js";
import { makeUploader } from "./wowaudit/upload.js";

async function main(): Promise<void> {
    const config = loadConfig();
    const db = openDb(config.dbPath);
    migrate(db, { migrationsFolder: "./drizzle" });
    log.info({ dbPath: config.dbPath }, "db ready");

    let raidbotsSession: RaidbotsSession | null = null;
    let qeliveSession: QELiveSession | null = null;
    let executor: Executor;
    if (config.raidbots.executor === "playwright") {
        raidbotsSession = new RaidbotsSession({
            userDataDir: config.raidbots.userDataDir,
            headless: config.raidbots.headless,
        });
        qeliveSession = new QELiveSession({
            userDataDir: config.qelive.userDataDir,
            headless: config.qelive.headless,
        });
        const raidbotsExecutor = makeRaidbotsExecutor(
            raidbotsSession,
            config.raidbots.credentials,
        );
        const qeliveExecutor = makeQELiveExecutor(qeliveSession, db);
        executor = makeDispatchExecutor({
            db,
            raidbots: raidbotsExecutor,
            qelive: qeliveExecutor,
        });
        log.info(
            { ...config.raidbots, credentials: undefined, qelive: config.qelive },
            "using playwright dispatch executor (raidbots + qelive)",
        );
    } else {
        executor = stubExecutor;
        log.info("using stub executor (no real sims will run)");
    }

    const client = createClient();
    const triggerStatusUpdate = makeStatusUpdater(client, db, config.requestSimcs.staleDays);
    const wowauditUploader = config.wowaudit ? makeUploader(config.wowaudit, db) : null;
    if (wowauditUploader) {
        log.info({ baseUrl: config.wowaudit!.baseUrl }, "wowaudit upload enabled");
    }
    const worker = startWorker(db, config.sim, executor, {
        notify: (msg) => notifyAdmins(client, config.adminUserIds, msg),
        onJobChange: triggerStatusUpdate,
        onJobDone: wowauditUploader
            ? async ({ jobId, characterId, reportUrl }) => {
                  const character = getCharacterById(db, characterId);
                  if (!character) {
                      log.warn({ jobId, characterId }, "wowaudit: character not found; skipping");
                      return;
                  }
                  const result = await wowauditUploader({ jobId, reportUrl, character });
                  if (result.uploaded) markWowauditUploaded(db, jobId);
              }
            : undefined,
    });

    registerDmHandler(client, db, triggerStatusUpdate, worker.poke);
    registerChannelHandler(client, db, triggerStatusUpdate, worker.poke);
    registerInteractionHandler(
        client,
        db,
        worker,
        config.adminUserIds,
        config.requestSimcs.staleDays,
        triggerStatusUpdate,
        wowauditUploader,
    );

    const cronJob = config.requestSimcs.cron
        ? CronJob.from({
              cronTime: config.requestSimcs.cron,
              timeZone: "UTC",
              onTick: async () => {
                  log.info({ cron: config.requestSimcs.cron }, "request-simcs cron tick");
                  await requestSimcs(client, db, "all", config.requestSimcs.staleDays).catch(
                      (err) => log.error({ err }, "request-simcs cron tick failed"),
                  );
              },
              start: false,
          })
        : null;
    if (cronJob) log.info({ cron: config.requestSimcs.cron }, "request-simcs cron scheduled");

    client.on(Events.ClientReady, async (c) => {
        log.info(
            { user: c.user.tag, id: c.user.id, adminCount: config.adminUserIds.size },
            "discord bot ready",
        );
        await warmDmChannels(c, [...config.adminUserIds, ...listKnownDiscordIds(db)]);
        await updateStatusMessage(c, db, config.requestSimcs.staleDays).catch((err) =>
            log.error({ err }, "initial status update failed"),
        );
    });
    client.on(Events.Error, (err) => log.error({ err }, "client error"));
    client.on(Events.Warn, (msg) => log.warn({ msg }, "client warn"));
    client.on(Events.ShardError, (err) => log.error({ err }, "shard error"));

    // Push commands every launch — Discord's PUT endpoint is full-replace, so this keeps things in sync.
    registerCommands({
        discordToken: config.discordToken,
        discordAppId: config.discordAppId,
        discordGuildId: config.discordGuildId,
    }).catch((err) => log.error({ err }, "command registration failed"));

    await client.login(config.discordToken);
    cronJob?.start();

    const shutdown = (signal: string): void => {
        log.info({ signal }, "shutting down");
        cronJob?.stop();
        worker
            .stop()
            .finally(() => raidbotsSession?.close())
            .finally(() => qeliveSession?.close())
            .finally(() => client.destroy().finally(() => process.exit(0)));
    };
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
}

// Discord doesn't reliably deliver MESSAGE_CREATE for DM channels the bot has never opened
// (Partials.Channel notwithstanding). Pre-warm createDM() for everyone we know about.
async function warmDmChannels(client: Client, ids: Iterable<string>): Promise<void> {
    const seen = new Set<string>();
    let opened = 0;
    for (const id of ids) {
        if (seen.has(id)) continue;
        seen.add(id);
        try {
            await (await client.users.fetch(id)).createDM();
            opened++;
        } catch (err) {
            log.warn({ err, id }, "failed to warm DM channel");
        }
    }
    log.info({ opened }, "DM channels warmed");
}

main().catch((err) => {
    log.fatal({ err }, "fatal startup error");
    process.exit(1);
});
