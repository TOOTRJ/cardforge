import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  KNOWN_DIFFERENCES,
  LIMITS,
  baselineKey,
  knownFor,
  limitFailures,
  overLimits,
  staleKnownDifferences,
  serializeBaseline,
  toBaselineCase,
  type BaselineFile,
} from "./thresholds";
import { BASELINE_PATH, DIR, MEASURE, ONLY, PLATFORM, UPDATE, baselineFile, loadCases, readRun, recorded, type Result } from "./run";
import { PARITY_SIZES } from "./shared";

// ---------------------------------------------------------------------------
// After every case: the report, the baseline an update would write, and the
// two run-wide rules — every known difference is still needed, and an update
// records nothing over a limit that no known difference names.
// ---------------------------------------------------------------------------

function report(run: Result[], stale: string[]): string {
  const lines: string[] = [];
  const failed = run.filter((m) => m.failures.length);
  const verdict = MEASURE ? "measured (not judged)" : failed.length || stale.length ? "❌ differences" : "✅ within thresholds";
  lines.push(`## Preview ⇄ bake parity — ${verdict}`, "");
  lines.push(
    `${run.length} comparison(s) on ${PLATFORM} · ${recorded ? "limits + known differences + this platform's recorded baseline" : "limits + known differences (no recorded baseline for this platform)"}`,
    "",
  );
  for (const m of failed) {
    lines.push(`- **${m.id} @${m.size}** — ${m.why}`);
    for (const f of m.failures) lines.push(`  - ${f}`);
  }
  for (const name of stale) lines.push(`- known difference **${name}** is no longer measured anywhere — strike it from tests/parity/thresholds.ts`);
  if (failed.length || stale.length) lines.push("");
  for (const size of PARITY_SIZES) {
    const rows = run.filter((m) => m.size === size.name);
    if (!rows.length) continue;
    const all = rows.flatMap((m) => Object.values(m.regions));
    const max = (pick: (r: (typeof all)[number]) => number) => all.reduce((n, r) => Math.max(n, pick(r)), 0);
    const limits = LIMITS[size.name];
    lines.push(`### @${size.name} — ${rows.length} cases, ${all.length} regions`, "");
    lines.push("| | worst measured | limit |", "| --- | --- | --- |");
    lines.push(`| offset, px | ${max((r) => Math.abs(r.dx))} across, ${max((r) => Math.abs(r.dy))} down | ±${limits.shift} |`);
    lines.push(`| region mad | ${max((r) => r.mad).toFixed(1)} | ${limits.mad} |`);
    lines.push(`| region hot | ${(max((r) => r.hot) * 100).toFixed(1)} % | ${(limits.hot * 100).toFixed(0)} % |`);
    lines.push(`| card mad | ${rows.reduce((n, m) => Math.max(n, m.card.mad), 0).toFixed(2)} | ${limits.cardMad} |`);
    lines.push(`| worst tile mad | ${rows.reduce((n, m) => Math.max(n, m.tile.mad), 0).toFixed(1)} | ${limits.tileMad} |`, "");
    lines.push("| case | card mad | worst tile | regions: offset x,y · mad (over a limit in **bold**) |", "| --- | --- | --- | --- |");
    for (const m of rows) {
      const over = overLimits(m);
      const cell = Object.entries(m.regions)
        .map(([name, r]) => {
          const text = `${name} ${r.dx},${r.dy} · ${r.mad.toFixed(1)}`;
          return over.some((o) => o.region === name) ? `**${text}**` : text;
        })
        .join("; ");
      lines.push(`| ${m.id} | ${m.card.mad.toFixed(2)} | ${m.tile.mad.toFixed(0)} | ${cell} |`);
    }
    lines.push("");
  }
  if (KNOWN_DIFFERENCES.length) {
    lines.push("### Known differences (over a limit today)", "", "| name | size | regions | metric | bounds | measured on |", "| --- | --- | --- | --- | --- | --- |");
    for (const k of KNOWN_DIFFERENCES) {
      const hits = run.filter((m) => overLimits(m).some((o) => knownFor(m, o).includes(k)));
      lines.push(`| ${k.name} | ${k.size} | ${k.regions.join(", ")} | ${k.metric} | ${k.min} … ${k.max} | ${hits.length} case(s) |`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

test("the run as a whole: report, known differences, baseline", async () => {
  const cases = loadCases();
  const run = readRun();
  const full = ONLY.length === 0 && run.length === cases.length * PARITY_SIZES.length;
  const stale = full ? staleKnownDifferences(run).map((k) => k.name) : [];
  fs.writeFileSync(path.join(DIR, "report.md"), report(run, stale));

  // What an update would write: this platform's section replaced, the
  // others kept as they are.
  const next: BaselineFile = {
    note:
      "Recorded preview-against-bake offsets per platform (tests/parity/thresholds.ts, layer 3). Per region: [dx, dy, mad, hot]. Rewrite with `npm run test:parity -- --update`, never by hand; CI's numbers are the `parity-baseline` artifact.",
    platforms: {
      ...(baselineFile?.platforms ?? {}),
      [PLATFORM]: {
        recorded: new Date().toISOString().slice(0, 10),
        cases: Object.fromEntries(run.map((m) => [baselineKey(m), toBaselineCase(m)])),
      },
    },
  };
  if (full) {
    fs.mkdirSync(path.join(DIR, "next"), { recursive: true });
    fs.writeFileSync(path.join(DIR, "next", "baseline.json"), serializeBaseline(next));
  }

  if (UPDATE) {
    expect(full, "an update needs the whole matrix (drop --only)").toBe(true);
    const over = run.flatMap((m) => limitFailures(m).map((f) => `${m.id} @${m.size} — ${f}`));
    expect(over, "a baseline never records a value over a limit: describe it in KNOWN_DIFFERENCES (tests/parity/thresholds.ts) or fix it").toEqual([]);
    expect(stale, "a known difference nothing measures any more: strike it").toEqual([]);
    fs.writeFileSync(BASELINE_PATH, serializeBaseline(next));
    return;
  }
  if (MEASURE) return;
  expect(stale, "a known difference nothing measures any more: strike it from tests/parity/thresholds.ts").toEqual([]);
  if (full && recorded) {
    const extra = Object.keys(recorded).filter((key) => !run.some((m) => baselineKey(m) === key));
    expect(extra, "tests/parity/baseline.json holds cases the matrix no longer has: re-record it").toEqual([]);
  }
});
