# Agent Guidelines

## Testing is required
- **Every code change must include tests** — unit, integration, or both — unless testing is genuinely infeasible (e.g. real Playwright browser launch against live raidbots, the top-level `src/index.ts` bootstrap shim).
- If you believe a change is untestable, justify it explicitly in the PR description; the default answer is "write a test."
- Tests live next to the source they cover: `foo.ts` → `foo.test.ts`. Use the in-memory SQLite helper in [src/test-utils/db.ts](src/test-utils/db.ts) for anything DB-backed.
- Mock at the boundary, not in the middle: stub `discord.js`, `playwright`, and `fetch` at the integration edges; let pure logic run for real.

## Coverage must remain high
- Project-wide line coverage must stay **≥ 90%**. Drops below that require a justification comment in the PR.
- After non-trivial changes, run `pnpm test:coverage` and confirm no file regressed below its prior coverage by more than ~2 points.
- Never lower coverage to make a change easier — extract pure functions, mock at boundaries, or add fixtures instead.
- Coverage exclusions live in [vitest.config.ts](vitest.config.ts). Don't add to that list without a clear reason (e.g. real-browser entry points, top-level wiring shims).

## Running tests
- `pnpm test` — full suite, single run.
- `pnpm test:watch` — watch mode while iterating.
- `pnpm test:coverage` — full coverage report (text + html in `coverage/`).
- `pnpm test:coverage:open` — same, then opens the HTML report.

## Style
- TypeScript, ESM, strict. Prefer pure functions and dependency injection over module-level state.
- Don't add comments that just restate the code; explain *why* only when the reason isn't obvious from the names.
- Don't introduce mocks of internal modules when a fake at the I/O boundary works.
- Keep tests deterministic: use injectable clocks/RNG (see [src/queue/pacing.ts](src/queue/pacing.ts) for the pattern), or set explicit `Date` instances rather than relying on wall-clock time.

## Things hard to test (and what to do instead)
- **Playwright Page interactions** — write a tiny `makePage(...)` mock in the same test file, like [src/raidbots/automation.test.ts](src/raidbots/automation.test.ts) and [src/raidbots/apply-settings.test.ts](src/raidbots/apply-settings.test.ts).
- **discord.js Client events** — a Node `EventEmitter` is a sufficient stand-in for `Client`; emit `messageCreate` / `interactionCreate` directly. See [src/bot/handlers/dm.test.ts](src/bot/handlers/dm.test.ts).
- **Worker timing** — keep `minDelaySeconds` / `maxDelaySeconds` low (e.g. `1`) and poll for state with a `waitFor(predicate)` helper instead of `setTimeout` magic numbers.
