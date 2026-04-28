# CoffeeBot

A Discord bot for a WoW guild that collects each member's SimulationCraft (`/simc`) export, runs Raidbots Droptimizer sims for them on a weekly cadence, and publishes the results to a managed status channel.

## Intent

Replace the manual ritual of "every player runs their own droptimizer before raid and pastes the link into wowaudit" with: players paste simcs into one bot-managed channel, the bot does the rest.

The bot owns one message in that channel and keeps it in lock-step with the database — current roster, last-updated timestamp per (character, spec), and the latest sim status (queued / running / report link / failed).

## Status

**Working today**

- **Storage** — SQLite (drizzle ORM). One row per (owner, region, realm, name, **spec**); same character with multiple specs are tracked independently. Admin can pre-register characters via `/characters register` so the roster shows up before any simc has been submitted.
- **Status channel** — `/status setup #channel` designates a channel; the bot posts an embed with the roster, instructions, and a per-character status line (✅ fresh / ⚠️ stale / 🔴 missing, plus the latest sim's link or state). Players paste simcs there; bot reacts ✅, deletes the paste after 5s, and edits the embed (debounced).
- **Sim queue + worker** — single-concurrency worker with jittered pacing, per-day cap, and auto-pause + admin DM after 3 consecutive failures. Status updates fire on every job state transition. A sim is auto-enqueued whenever a player submits a simc (DM or status channel); pastes whose simc string matches the latest queued/running/done job are skipped so re-pastes don't burn the cap. Admins can bulk-trigger via `/sim run` / `/sim run-all`, or force a single (name, spec) re-sim with `/sim run-character` (bypasses the same-simc skip).
- **Raidbots automation** (Playwright, persistent Chromium profile) — auto-login (when `RAIDBOTS_EMAIL`/`RAIDBOTS_PASSWORD` are set), source / difficulty / fight-style configurable, always picks max upgrade ilvl, completes when the report page title flips off the in-progress placeholder. Behind the `RAIDBOTS_EXECUTOR=playwright` flag (default `stub`).
- **QELive automation for healers** (Playwright, separate persistent profile under `QELIVE_USER_DATA_DIR`) — same queue dispatches healer specs to QELive's Upgrade Finder (Mythic-Max, upgrade-all + upgrade-vault toggled on). Behind the same `RAIDBOTS_EXECUTOR=playwright` flag — when on, [src/queue/dispatch.ts](src/queue/dispatch.ts) routes healer jobs to [src/qelive/](src/qelive/) and everyone else to Raidbots.
- **Reminders** — `/sim request-simcs [mode:all|stale]` DMs each player asking for a refresh; optional cron schedule via `REQUEST_SIMCS_CRON`. DM points at the status channel; DMing the bot directly still works as a fallback.
- **wowaudit upload** — every successful sim (Raidbots **or** QELive) is POSTed to wowaudit's `/v1/wishlists` endpoint (`replace_manual_edits=true`, `clear_conduits=true`) and the job row is stamped with `wowaudit_uploaded_at`. Enabled when `WOWAUDIT_API_KEY` is set; the API key alone identifies the team. Upload failures are logged but never fail the sim itself. Reports that pre-date the upload feature can be flushed with `/sim backfill-wowaudit` (one-shot, sequential, idempotent — already-uploaded jobs are skipped).
- **wowutils paste-script generator** — `pnpm wowutils:script` builds a self-contained browser-console snippet that uploads the latest report per character into [wowutils.com](https://wowutils.com). wowutils has no API yet and uses Battle.net SSO, so this is a manual paste-into-devtools step (you sign in once, paste the script, watch it iterate the roster with human-speed jitter). For characters with multiple specs simmed, the CLI prompts which spec to upload and persists the choice to `data/wowutils-spec-preferences.json` for next time.
- **Slash commands** auto-register on every boot.

**Remaining**

- **wowaudit `character_id` resolution** — the `/v1/wishlists` payload includes a `character_id` field in the swagger example; we currently send only `character_name` and let wowaudit resolve. If that turns out to be unreliable (multiple toons sharing a name across realms, etc.), we'll need a `GET /v1/characters` lookup pass to map our character rows to wowaudit's internal ids.
- **More failure-mode coverage** — currently auto-pauses after 3 consecutive failures. Could differentiate transient (single retry) vs permanent (pause), and detect specific raidbots blocking pages (queue full / captcha) earlier in the flow.
- **Live Playwright validation** — the playwright executor is unit-tested with mocked Page objects, but the live raidbots and qelive flows are still only exercised manually via `pnpm sim:test-once` / `pnpm qelive:test-once`. A scheduled smoke run against a fixed test character would catch DOM breakage earlier.

## Quickstart

```bash
pnpm install
cp .env.example .env       # fill in DISCORD_TOKEN, DISCORD_APP_ID, DISCORD_ADMIN_USER_IDS
pnpm db:migrate
pnpm dev
```

Then in your server: `/status setup channel:#droptimizer` (the bot needs View / Send / Embed / Add Reactions / Read History / Manage Messages in that channel).

`/help` (admin, ephemeral) lists everything else.

## Scripts

| | |
|---|---|
| `pnpm dev` / `pnpm start` | Run the bot (watch / built) |
| `pnpm test` / `pnpm test:coverage` | Unit tests + coverage report under `coverage/` (268 tests, ~98% line coverage) |
| `pnpm typecheck` / `pnpm lint` / `pnpm format` | TS check (covers source **and** tests via [tsconfig.test.json](tsconfig.test.json)), ESLint, Prettier |
| `pnpm db:generate` / `pnpm db:migrate` | Drizzle migrations |
| `pnpm sim:test-once <simc-file>` | Run one Raidbots sim end-to-end without going through the bot |
| `pnpm qelive:test-once <simc-file>` | Run one QELive Upgrade Finder pass for a healer simc |
| `pnpm wowutils:script` | Generate the wowutils paste-into-console upload snippet at `data/wowutils-script.js` (interactive when any character has >1 spec simmed) |
| `pnpm docker:build` / `pnpm docker:run` / `pnpm docker:logs` / `pnpm docker:stop` | Local Docker workflow — build the image, run it detached against `./data` (mounted to `/data` in-container), tail logs, stop |
| `pnpm fly:deploy` / `pnpm fly:start` / `pnpm fly:stop` / `pnpm fly:logs` / `pnpm fly:status` / `pnpm fly:ssh` | Fly.io deploy + machine lifecycle. `fly:start`/`fly:stop` operate on the single app machine (no ID needed unless there's >1) |

For a one-off Raidbots dry-run with the browser visible:
```bash
PLAYWRIGHT_HEADLESS=false SUBMIT=false pnpm sim:test-once ./simc.example
```

## Operating notes

Raidbots has no public sim API and the maintainer is openly hostile to scraping that affects service quality. The pacing defaults (`SIM_MIN_DELAY_SECONDS=75`, `SIM_DAILY_CAP=30`) are deliberately conservative — don't lower them just to run faster.

When raidbots changes its DOM and a selector breaks, the failing log line tells you which step. Selectors live as plain Playwright locators in [src/raidbots/apply-settings.ts](src/raidbots/apply-settings.ts), [automation.ts](src/raidbots/automation.ts), and [login.ts](src/raidbots/login.ts) — the easiest update path is a Claude Code session with the Playwright MCP server enabled. The same applies to QELive's selectors in [src/qelive/import-gear.ts](src/qelive/import-gear.ts), [apply-settings.ts](src/qelive/apply-settings.ts), and [automation.ts](src/qelive/automation.ts).

## Working with this repo

See [CLAUDE.md](CLAUDE.md) for agent (and human) guidelines: tests are required for every change, project-wide line coverage stays ≥ 90%, and patterns for mocking Playwright / discord.js live alongside the existing tests.
