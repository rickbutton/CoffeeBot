import {
    type ChatInputCommandInteraction,
    InteractionContextType,
    MessageFlags,
    SlashCommandBuilder,
} from "discord.js";
import type { Db } from "../../db/client.js";
import { utcDayStart } from "../../queue/pacing.js";
import { cancelJob, enqueueAll, enqueueForOwner, queueStatus } from "../../queue/repo.js";
import type { WorkerHandle } from "../../queue/worker.js";
import { requestSimcs, type RequestMode } from "../request-simcs.js";

const EPHEMERAL = MessageFlags.Ephemeral;

export const simCommand = new SlashCommandBuilder()
    .setName("sim")
    .setDescription("Run / inspect droptimizer sim jobs (admin only).")
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
        s.setName("run-all").setDescription("Enqueue a sim job for every stored character."),
    )
    .addSubcommand((s) =>
        s
            .setName("run")
            .setDescription("Enqueue sim jobs for one user's characters.")
            .addUserOption((o) =>
                o.setName("user").setDescription("Whose characters to sim").setRequired(true),
            ),
    )
    .addSubcommand((s) => s.setName("status").setDescription("Show queue status."))
    .addSubcommand((s) => s.setName("pause").setDescription("Pause the worker."))
    .addSubcommand((s) => s.setName("resume").setDescription("Resume the worker."))
    .addSubcommand((s) =>
        s
            .setName("cancel")
            .setDescription("Cancel a queued job by id.")
            .addIntegerOption((o) =>
                o.setName("id").setDescription("Job id from /sim status").setRequired(true),
            ),
    )
    .addSubcommand((s) =>
        s
            .setName("request-simcs")
            .setDescription("DM each player asking them to refresh their simcs.")
            .addStringOption((o) =>
                o
                    .setName("mode")
                    .setDescription(
                        "all = DM everyone (default); stale = re-ping only stale or missing",
                    )
                    .setRequired(false)
                    .addChoices({ name: "all", value: "all" }, { name: "stale", value: "stale" }),
            ),
    )
    .toJSON();

export async function handleSimCommand(
    interaction: ChatInputCommandInteraction,
    db: Db,
    worker: WorkerHandle,
    adminUserIds: Set<string>,
    staleDays: number,
): Promise<void> {
    if (!adminUserIds.has(interaction.user.id)) {
        await interaction.reply({ content: ":no_entry: Admin only.", flags: EPHEMERAL });
        return;
    }
    const sub = interaction.options.getSubcommand(true);

    if (sub === "run-all") {
        const r = enqueueAll(db);
        worker.poke();
        await interaction.reply({
            content: `:gear: Enqueued **${r.enqueued}** job(s)${skippedSuffix(r.skippedNoSimc)}.`,
            flags: EPHEMERAL,
        });
        return;
    }

    if (sub === "run") {
        const target = interaction.options.getUser("user", true);
        const r = enqueueForOwner(db, target.id);
        worker.poke();
        await interaction.reply({
            content:
                r.enqueued === 0 && r.skippedNoSimc === 0
                    ? `<@${target.id}> has no stored characters.`
                    : `:gear: Enqueued **${r.enqueued}** job(s) for <@${target.id}>${skippedSuffix(r.skippedNoSimc)}.`,
            flags: EPHEMERAL,
            allowedMentions: { parse: [] },
        });
        return;
    }

    if (sub === "status") {
        const status = queueStatus(db, utcDayStart());
        const lines = [
            `**Worker:** ${worker.isPaused() ? ":pause_button: paused" : ":arrow_forward: running"}`,
            `**Queued:** ${status.queued}   **Running:** ${status.running}`,
            `**Today (UTC):** :white_check_mark: ${status.doneToday} done · :x: ${status.failedToday} failed`,
            "",
            "**Recent jobs:**",
            ...(status.recent.length === 0
                ? ["_(none)_"]
                : status.recent.map((j) => {
                      const url = j.raidbotsUrl ? ` <${j.raidbotsUrl}>` : "";
                      const err = j.error ? ` — ${j.error.slice(0, 80)}` : "";
                      return `\`#${j.id}\` char ${j.characterId} · **${j.status}**${url}${err}`;
                  })),
        ];
        await interaction.reply({
            content: lines.join("\n"),
            flags: EPHEMERAL,
            allowedMentions: { parse: [] },
        });
        return;
    }

    if (sub === "pause") {
        worker.pause();
        await interaction.reply({
            content:
                ":pause_button: Worker paused. In-flight job will complete; new jobs won't start.",
            flags: EPHEMERAL,
        });
        return;
    }

    if (sub === "resume") {
        worker.resume();
        await interaction.reply({ content: ":arrow_forward: Worker resumed.", flags: EPHEMERAL });
        return;
    }

    if (sub === "cancel") {
        const id = interaction.options.getInteger("id", true);
        const ok = cancelJob(db, id);
        await interaction.reply({
            content: ok
                ? `:wastebasket: Cancelled job \`#${id}\`.`
                : `:question: Job \`#${id}\` isn't queued (already running, done, or doesn't exist).`,
            flags: EPHEMERAL,
        });
        return;
    }

    if (sub === "request-simcs") {
        const mode = (interaction.options.getString("mode") ?? "all") as RequestMode;
        await interaction.deferReply({ flags: EPHEMERAL });
        const r = await requestSimcs(interaction.client, db, mode, staleDays);
        const skip =
            r.usersSkipped > 0
                ? `. Skipped ${r.usersSkipped} user(s) — DM closed or fetch failed.`
                : ".";
        await interaction.editReply({
            content:
                `:envelope: Sent **${r.usersDmed}** DM(s) covering **${r.charactersCovered}** character(s) ` +
                `(${r.stale} stale, ${r.neverSubmitted} never-submitted)${skip}`,
            allowedMentions: { parse: [] },
        });
        return;
    }
}

function skippedSuffix(skipped: number): string {
    return skipped > 0 ? ` (skipped ${skipped} — no simc submitted yet)` : "";
}
