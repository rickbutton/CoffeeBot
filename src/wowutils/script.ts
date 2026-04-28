import type { WowutilsReport } from "./select.js";

export type ScriptOptions = {
    /** Min/max delay (ms) between intra-modal user actions (paste, click). */
    minActionDelayMs: number;
    maxActionDelayMs: number;
    /** Min/max delay (ms) between consecutive characters. Slightly longer to look human. */
    minBetweenCharsMs: number;
    maxBetweenCharsMs: number;
    /** Per-step waitFor timeout (ms). Fetch Report can be slow on busy days. */
    perStepTimeoutMs: number;
};

export const DEFAULT_OPTIONS: ScriptOptions = {
    minActionDelayMs: 800,
    maxActionDelayMs: 2200,
    minBetweenCharsMs: 1500,
    maxBetweenCharsMs: 4000,
    perStepTimeoutMs: 30_000,
};

/**
 * Build a browser-console snippet that loops through `reports` and uploads
 * each one through the wowutils "Import Droptimizer" modal. The snippet is
 * self-contained — it embeds the report list and the timing options.
 *
 * Pre-conditions for the snippet to work:
 *  - The user is on the wowutils group's Loot Wishlist → Droptimizers tab.
 *  - The user is signed in.
 */
export function buildWowutilsScript(
    reports: WowutilsReport[],
    overrides: Partial<ScriptOptions> = {},
): string {
    const options: ScriptOptions = { ...DEFAULT_OPTIONS, ...overrides };
    const reportsLiteral = JSON.stringify(reports, null, 2);
    const optionsLiteral = JSON.stringify(options, null, 2);
    return `(async () => {
  const REPORTS = ${reportsLiteral};
  const OPTS = ${optionsLiteral};

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const jitter = (min, max) => min + Math.random() * (max - min);
  const log = (...a) => console.log("%c[wowutils]", "color:#7af", ...a);
  const warn = (...a) => console.warn("[wowutils]", ...a);
  const errLog = (...a) => console.error("[wowutils]", ...a);

  const waitFor = async (predicate, label) => {
    const start = Date.now();
    while (Date.now() - start < OPTS.perStepTimeoutMs) {
      try {
        const r = predicate();
        if (r) return r;
      } catch (_) {}
      await sleep(120);
    }
    throw new Error("timed out waiting for: " + label);
  };

  const setReactInputValue = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    ).set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const findButton = (text, { exact = false, notDisabled = false } = {}) =>
    [...document.querySelectorAll("button")].find((b) => {
      const t = (b.textContent || "").trim();
      const matches = exact ? t === text : t.includes(text);
      if (!matches) return false;
      if (notDisabled && b.disabled) return false;
      return true;
    });

  const modalIsOpen = () =>
    [...document.querySelectorAll("h2")].some(
      (h) => h.textContent.trim() === "Import Droptimizer",
    );

  const findRowButton = (characterName, classKey) => {
    const candidates = [
      ...document.querySelectorAll(
        \`button[title="Import droptimizer for \${characterName}"]\`,
      ),
    ];
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];
    if (!classKey) return null;
    // wowutils renders the row icon as either
    //   /.../spec-icons/<classKey>/<spec>.png   (no sim imported yet)
    // or
    //   /.../class-icons/<size>/<classKey>.png  (a sim has been imported)
    // so a path-fragment like "/<classKey>/" or "/<classKey>." identifies the class either way.
    // classKey is restricted to lowercase letters by classNameToWowutilsKey, so no escaping is needed.
    const re = new RegExp("/" + classKey + "[/.]");
    for (const b of candidates) {
      const row = b.closest("tr");
      if (!row) continue;
      const hasClass = [...row.querySelectorAll("img[src]")].some((i) =>
        re.test(i.src),
      );
      if (hasClass) return b;
    }
    return null;
  };

  const closeOpenModal = async () => {
    if (!modalIsOpen()) return;
    const close = findButton("Close", { exact: true });
    try {
      close && close.click();
    } catch (_) {}
    try {
      await waitFor(() => !modalIsOpen(), "modal close");
    } catch (_) {
      warn("modal failed to close cleanly; pressing Escape as a fallback");
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      await sleep(500);
    }
  };

  // Make sure all members (mains + alts) are visible. The "All" button is a
  // simple toggle; clicking it when already active is a no-op.
  const allBtn = findButton("All", { exact: true });
  if (allBtn) {
    allBtn.click();
    await sleep(400);
    log("Clicked 'All' filter");
  } else {
    warn("Could not find 'All' filter button — proceeding with current view");
  }

  const summary = { uploaded: 0, skipped: 0, failed: 0 };

  for (let i = 0; i < REPORTS.length; i++) {
    const { characterName, classKey, spec, reportUrl } = REPORTS[i];
    const tag = spec ? characterName + "/" + spec : characterName;
    log("(" + (i + 1) + "/" + REPORTS.length + ") " + tag + " → " + reportUrl);
    try {
      const rowBtn = findRowButton(characterName, classKey);
      if (!rowBtn) {
        warn("No row found for " + tag + " — skipping (not on roster?)");
        summary.skipped++;
        continue;
      }
      rowBtn.scrollIntoView({ block: "center", behavior: "smooth" });
      await sleep(200);
      rowBtn.click();

      const input = await waitFor(
        () => document.querySelector('input[placeholder^="Paste"]'),
        "URL input",
      );
      await sleep(jitter(OPTS.minActionDelayMs, OPTS.maxActionDelayMs));
      setReactInputValue(input, reportUrl);

      const fetchBtn = await waitFor(
        () => findButton("Fetch Report", { notDisabled: true }),
        "Fetch Report button",
      );
      await sleep(jitter(OPTS.minActionDelayMs, OPTS.maxActionDelayMs));
      fetchBtn.click();

      const importBtn = await waitFor(
        () => findButton("Import", { exact: true, notDisabled: true }),
        "Import button (preview state)",
      );

      // Spec/class mismatch detection — if the URL's character is a different
      // class than the row we clicked, wowutils warns and we MUST abort:
      // importing would silently overwrite the row with the wrong sim.
      const dialogText = document.body.textContent || "";
      if (/but you are importing for/i.test(dialogText)) {
        warn("Class mismatch warning shown for " + tag + " — backing out");
        const back = findButton("Back", { exact: true });
        if (back) back.click();
        await sleep(300);
        await closeOpenModal();
        summary.skipped++;
        await sleep(jitter(OPTS.minBetweenCharsMs, OPTS.maxBetweenCharsMs));
        continue;
      }

      await sleep(jitter(OPTS.minActionDelayMs, OPTS.maxActionDelayMs));
      importBtn.click();

      // Success banner reads "Imported H 6/6: 29 raid items" (or M 6/6, etc.).
      // We look for any element whose trimmed text starts with "Imported ".
      await waitFor(
        () =>
          [...document.querySelectorAll("p, span, div")].some((el) =>
            /^Imported\\s\\S/.test((el.textContent || "").trim()),
          ),
        "Imported success banner",
      );
      summary.uploaded++;
      log("  ✓ " + tag);

      await sleep(jitter(OPTS.minActionDelayMs, OPTS.maxActionDelayMs));
      await closeOpenModal();
      await sleep(jitter(OPTS.minBetweenCharsMs, OPTS.maxBetweenCharsMs));
    } catch (e) {
      errLog("Failed for " + tag + ": " + (e && e.message ? e.message : e));
      summary.failed++;
      await closeOpenModal();
      await sleep(1500);
    }
  }

  log("Done.", summary);
  return summary;
})();
`;
}
