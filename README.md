# CoffeeBot

A Discord bot for a WoW guild that collects each member's SimulationCraft (`/simc`) export, runs Raidbots Droptimizer sims for them on a weekly cadence, and publishes the results to a managed status channel.

## Intent

Replace the manual ritual of "every player runs their own droptimizer before raid and pastes the link into wowaudit" with: players paste simcs into one bot-managed channel, the bot does the rest.

The bot owns one message in that channel and keeps it in lock-step with the database — current roster, last-updated timestamp per (character, spec), and the latest sim status (queued / running / report link / failed).

## Status

**Working today**

- **Storage** — SQLite (drizzle ORM). One row per (owner, region, realm, name, **spec**); same character with multiple specs are tracked independently. Admin can pre-register characters via `/characters register` so the roster shows up before any simc has been submitted.
- **Status channel** — `/status setup #channel` designates a channel; the bot posts an embed with the roster, instructions, and a per-character status line (✅ fresh / ⚠️ stale / 🔴 missing, plus the latest sim's link or state). Players paste simcs there; bot reacts ✅, deletes the paste after 5s, and edits the embed (debounced).
- **Sim queue + worker** — single-concurrency worker with jittered pacing, per-day cap, and auto-pause + admin DM after 3 consecutive failures. Status updates fire on every job state transition.
- **Raidbots automation** (Playwright, persistent Chromium profile) — auto-login (when `RAIDBOTS_EMAIL`/`RAIDBOTS_PASSWORD` are set), source / difficulty / fight-style configurable, always picks max upgrade ilvl, completes when the report page title flips off the in-progress placeholder. Behind the `RAIDBOTS_EXECUTOR=playwright` flag (default `stub`).
- **Reminders** — `/sim request-simcs [mode:all|stale]` DMs each player asking for a refresh; optional cron schedule via `REQUEST_SIMCS_CRON`. DM points at the status channel; DMing the bot directly still works as a fallback.
- **Slash commands** auto-register on every boot.

**Remaining**

- **wowaudit upload** (Phase 4) — POST each completed report URL to wowaudit's wishlist endpoint and stamp `wowauditUploadedAt`. Schema column already exists; needs the actual API call wired in. Requires `WOWAUDIT_API_KEY` / `WOWAUDIT_TEAM_ID` and confirmation of the endpoint shape from wowaudit's team-admin docs.
- **More failure-mode coverage** — currently auto-pauses after 3 consecutive failures. Could differentiate transient (single retry) vs permanent (pause), and detect specific raidbots blocking pages (queue full / captcha) earlier in the flow.
- **Test coverage** — only the simc parser and pacing module are unit-tested today (~7% line coverage). The Playwright flow is exercised manually via `pnpm sim:test-once`; the rest is end-to-end-tested by running the bot.

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
| `pnpm test` / `pnpm test:coverage` | Unit tests + coverage report under `coverage/` |
| `pnpm typecheck` / `pnpm lint` / `pnpm format` | TS check, ESLint, Prettier |
| `pnpm db:generate` / `pnpm db:migrate` | Drizzle migrations |
| `pnpm sim:test-once <simc-file>` | Run one Raidbots sim end-to-end without going through the bot |

For a one-off Raidbots dry-run with the browser visible:
```bash
PLAYWRIGHT_HEADLESS=false SUBMIT=false pnpm sim:test-once ./simc.example
```

## Operating notes

Raidbots has no public sim API and the maintainer is openly hostile to scraping that affects service quality. The pacing defaults (`SIM_MIN_DELAY_SECONDS=75`, `SIM_DAILY_CAP=30`) are deliberately conservative — don't lower them just to run faster.

When raidbots changes its DOM and a selector breaks, the failing log line tells you which step. Selectors live as plain Playwright locators in [src/raidbots/apply-settings.ts](src/raidbots/apply-settings.ts), [automation.ts](src/raidbots/automation.ts), and [login.ts](src/raidbots/login.ts) — the easiest update path is a Claude Code session with the Playwright MCP server enabled.
