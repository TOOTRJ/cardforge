import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  KNOWN_DIFFERENCES,
  LIMITS,
  WITHIN_LIMIT_DIFFERENCES,
  baselineKey,
  knownFor,
  limitFailures,
  overLimits,
  staleKnownDifferences,
} from "./thresholds";
import { BASELINE_DIR, applyDelta, baselinePlatforms, caseFiles, platformDelta, planUpdate, type UpdatePlan } from "./baseline";
import { DIR, MEASURE, ONLY, PLATFORM, ROOT, UPDATE, UPDATE_ALL, loadCases, readRun, recorded, type Result } from "./run";
import { PARITY_SIZES } from "./shared";

// ---------------------------------------------------------------------------
// After every case: the report, the baseline an update would write, and the
// two run-wide rules — every known difference is still needed, and an update
// records nothing over a limit that no known difference names.
// ---------------------------------------------------------------------------

function report(run: Result[], stale: string[], plan: UpdatePlan | null): string {
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
  // The baseline lines an update rewrites: the cases that are new or left
  // their recorded tolerance, and no other (tests/parity/baseline.ts).
  if (plan && (plan.changed.length || plan.removed.length)) {
    lines.push(
      `### Baseline lines \`--update\` ${UPDATE ? "rewrote" : "would rewrite"} on ${PLATFORM} — ${plan.changed.length} of ${plan.changed.length + plan.kept.length}${UPDATE_ALL ? " (`--all`: every line re-recorded)" : ""}`,
      "",
    );
    for (const c of plan.changed) lines.push(`- \`${c.key}\` — ${c.why.length > 3 ? `${c.why.slice(0, 3).join("; ")}; … (${c.why.length - 3} more)` : c.why.join("; ")}`);
    for (const key of plan.removed) lines.push(`- \`${key}\` — removed (the matrix no longer has the case)`);
    lines.push("");
  }
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
  if (WITHIN_LIMIT_DIFFERENCES.length) {
    lines.push("### Described differences inside the limits", "", "| name | size | regions | metric | recorded | measured |", "| --- | --- | --- | --- | --- | --- |");
    for (const k of WITHIN_LIMIT_DIFFERENCES) {
      const values = run
        .filter((m) => m.size === k.size && k.cases.test(m.id))
        .flatMap((m) => k.regions.map((region) => m.regions[region]?.[k.metric as "dx" | "dy"]))
        .filter((value) => value !== undefined);
      lines.push(`| ${k.name} | ${k.size} | ${k.regions.join(", ")} | ${k.metric} | ${k.min} … ${k.max} | ${values.join(", ") || "—"} |`);
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

  // What an update writes for THIS platform (tests/parity/baseline.ts): the
  // files of the cases that are new or outside their recorded tolerance —
  // every other file stays as it is, byte for byte.
  const plan = full ? planUpdate({ stored: recorded, run, all: UPDATE_ALL }) : null;
  fs.writeFileSync(path.join(DIR, "report.md"), report(run, stale, plan));
  const files = plan ? caseFiles(plan.cases) : null;
  const delta = files ? platformDelta(ROOT, PLATFORM, files) : null;
  // …left in tmp/parity/next/ whether or not this run updates: CI uploads
  // it as the `parity-baseline` artifact and scripts/parity.mjs prints it
  // as a paste-able script (the linux half of a re-record).
  if (plan && delta && (delta.write.length || delta.remove.length)) {
    const next = path.join(DIR, "next");
    fs.mkdirSync(path.join(next, PLATFORM), { recursive: true });
    for (const file of delta.write) fs.writeFileSync(path.join(next, PLATFORM, file.name), file.text);
    fs.writeFileSync(
      path.join(next, "update.json"),
      `${JSON.stringify({ platform: PLATFORM, dir: BASELINE_DIR, write: delta.write.map((f) => f.name), remove: delta.remove, changed: plan.changed, kept: plan.kept.length }, null, 1)}\n`,
    );
  }

  if (UPDATE) {
    expect(full, "an update needs the whole matrix (drop --only)").toBe(true);
    const over = run.flatMap((m) => limitFailures(m).map((f) => `${m.id} @${m.size} — ${f}`));
    expect(over, "a baseline never records a value over a limit: describe it in KNOWN_DIFFERENCES (tests/parity/thresholds.ts) or fix it").toEqual([]);
    expect(stale, "a known difference nothing measures any more: strike it").toEqual([]);
    applyDelta(ROOT, PLATFORM, delta!);
    // A case the matrix no longer has is gone on every platform: its files
    // in the other platforms' directories go with it (nothing else there
    // is touched — their numbers are that platform's own).
    const orphans = baselinePlatforms(ROOT)
      .filter((platform) => platform !== PLATFORM)
      .map((platform) => ({ platform, delta: platformDelta(ROOT, platform, files!, "orphans") }));
    for (const o of orphans) applyDelta(ROOT, o.platform, o.delta);
    console.log(
      [
        `\nbaseline (${PLATFORM})${UPDATE_ALL ? " — --all: EVERY case re-recorded, also those inside their tolerance" : ""}: ${plan!.changed.length} case line(s) rewritten, ${plan!.kept.length} kept byte for byte, ${delta!.remove.length} file(s) removed.`,
        ...plan!.changed.map((c) => `  ~ ${c.key} — ${c.why[0]}${c.why.length > 1 ? ` (+${c.why.length - 1})` : ""}`),
        ...delta!.remove.map((name) => `  - ${BASELINE_DIR}/${PLATFORM}/${name}`),
        ...orphans.flatMap((o) => o.delta.remove.map((name) => `  - ${BASELINE_DIR}/${o.platform}/${name} (a case the matrix no longer has)`)),
      ].join("\n"),
    );
    return;
  }
  if (MEASURE) return;
  expect(stale, "a known difference nothing measures any more: strike it from tests/parity/thresholds.ts").toEqual([]);
  if (full && recorded) {
    const extra = Object.keys(recorded).filter((key) => !run.some((m) => baselineKey(m) === key));
    expect(extra, `${BASELINE_DIR}/${PLATFORM}/ holds cases the matrix no longer has: re-record it (npm run test:parity -- --update removes their files)`).toEqual([]);
  }
});
