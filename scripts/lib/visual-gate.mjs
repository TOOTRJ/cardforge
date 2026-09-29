// ---------------------------------------------------------------------------
// visual-gate.mjs — the pure half of the visual-regression suite (TODO 7.1),
// used by scripts/visual-regression.mjs and unit-tested
// (tests/unit/devops/visual-gate.test.ts).
//
// The bake (tests/visual/bake.visual.ts) hashes every case of
// tests/visual/matrix.ts; this module compares those hashes with the
// committed baseline (tests/visual/baseline.json — hashes only, never a
// pixel: the matrix draws Card Conjurer-derived frames, which never enter
// git) and decides:
//
//   * a changed hash FAILS unless this PR bumped CARD_LAYOUT_VERSION — and
//     then it still fails, with the diff list and the regenerate command,
//     until the regenerated baseline is committed in the same PR (so the
//     baseline never goes stale on main and the next PR is never blamed);
//   * with a bump, a changed case the bump's scope does NOT cover
//     (isRenderStale says a card stamped at the BASE branch's version is
//     still current) fails on its own — before and after the baseline is
//     regenerated: the sweep would stamp that card without re-baking it, and
//     its stored image would stay old for good;
//   * a baseline whose hashes changed against the base branch's without a
//     bump fails too (regenerating is not a way around the bump);
//   * new, removed or REDEFINED cases (the case's input fingerprint — its
//     row, preset and corners — changed: a tests/visual/matrix.ts edit, not a
//     renderer change) need a regenerated baseline, never a bump;
//   * a PRINT-ONLY case (square corners: the PDF and the Square download,
//     rendered live, never stored) that changes needs the regenerated
//     baseline, never a bump, and is never "outside the bump's scope" —
//     its round sibling in the matrix carries any stored-image change;
//   * a render error, or a fetch the bake refused, always fails.
//
// A baseline entry is "<16-hex pixel hash>:<8-hex input fingerprint>".
// ---------------------------------------------------------------------------

export const BASELINE_PATH = "tests/visual/baseline.json";
export const LAYOUT_VERSION_PATH = "lib/cards/layout-version.ts";

/** `export const CARD_LAYOUT_VERSION = 34;` → 34 (null when absent). */
export function parseLayoutVersion(source) {
  const m = /export const CARD_LAYOUT_VERSION\s*=\s*(\d+)\s*;/.exec(source ?? "");
  return m ? Number(m[1]) : null;
}

/** "3/4" → { index: 3, count: 4 }; throws on anything else. */
export function parseShard(value) {
  const m = /^(\d+)\/(\d+)$/.exec(String(value));
  if (!m || Number(m[2]) < 1 || Number(m[1]) >= Number(m[2])) throw new Error(`Bad shard "${value}" (want i/n, 0 ≤ i < n).`);
  return { index: Number(m[1]), count: Number(m[2]) };
}

/**
 * Merge the shards' result files into one run. Every shard must have baked
 * with the same code and tools (same layout version, same environment); a
 * shard that doesn't is a harness fault, not a pixel change.
 */
export function mergeShardResults(shards) {
  if (shards.length === 0) throw new Error("No shard results.");
  const [first] = shards;
  const cases = {};
  const blocked = new Set();
  let seconds = 0;
  for (const shard of shards) {
    if (shard.layoutVersion !== first.layoutVersion) throw new Error("Shards baked at different layout versions.");
    if ((shard.baseVersion ?? null) !== (first.baseVersion ?? null)) throw new Error("Shards judged the bump's scope at different base versions.");
    // Node's patch version is informational (parallel CI jobs may resolve a
    // different 24.x); everything that draws pixels must match.
    const tools = (env) => JSON.stringify({ ...env, node: undefined });
    if (tools(shard.environment ?? {}) !== tools(first.environment ?? {})) {
      throw new Error("Shards baked with different tools or inputs (environment differs).");
    }
    for (const [id, result] of Object.entries(shard.cases)) {
      if (id in cases) throw new Error(`Case ${id} baked by two shards.`);
      cases[id] = result;
    }
    for (const url of shard.blocked ?? []) blocked.add(url);
    seconds = Math.max(seconds, shard.seconds ?? 0);
  }
  return {
    layoutVersion: first.layoutVersion,
    baseVersion: first.baseVersion ?? null,
    environment: first.environment,
    seconds,
    blocked: [...blocked].sort(),
    cases,
  };
}

/** "<pixel>:<input>" → { pixel, input } (input null when the entry has none). */
export function parseEntry(entry) {
  const [pixel, input] = String(entry ?? "").split(":");
  return { pixel, input: input || null };
}

/** Two inputs differ only when both are known. */
const redefinedInput = (a, b) => a != null && b != null && a !== b;

/**
 * The run against a baseline. `partial` (a --only run): only the cases that
 * ran are compared — nothing counts as added or removed. A case whose input
 * fingerprint differs from the baseline's was REDEFINED (the matrix changed
 * what it draws): like a new case, never a pixel change.
 */
export function compareToBaseline(run, baseline, { partial = false } = {}) {
  const expected = baseline?.cases ?? {};
  const changed = [];
  const added = [];
  const redefined = [];
  const errors = [];
  let unchanged = 0;
  for (const id of Object.keys(run.cases).sort()) {
    const result = run.cases[id];
    if (result.error || !result.hash) {
      errors.push({ id, error: result.error ?? "no hash" });
      continue;
    }
    if (!(id in expected)) {
      added.push(id);
      continue;
    }
    const was = parseEntry(expected[id]);
    if (redefinedInput(was.input, result.input ?? null)) redefined.push(id);
    else if (was.pixel !== result.hash) changed.push({ id, from: was.pixel, to: result.hash, stale: result.stale ?? null });
    else unchanged += 1;
  }
  const removed = partial ? [] : Object.keys(expected).filter((id) => !(id in run.cases)).sort();
  return { changed, added, removed, redefined, errors, unchanged };
}

/** Ids whose pixel hash differs between two baselines for the SAME input
 *  (ids in only one are new or removed cases, a changed input is a
 *  redefined case — never a pixel change). */
export function baselineDrift(head, base) {
  if (!head?.cases || !base?.cases) return [];
  return Object.keys(head.cases)
    .filter((id) => {
      if (!(id in base.cases)) return false;
      const now = parseEntry(head.cases[id]);
      const was = parseEntry(base.cases[id]);
      return !redefinedInput(now.input, was.input) && now.pixel !== was.pixel;
    })
    .sort();
}

/**
 * @param {{
 *   comparison: ReturnType<typeof compareToBaseline>,
 *   run: { blocked?: string[], baseVersion?: number | null, cases: Record<string, { stale?: boolean, printOnly?: boolean }> },
 *   headBaseline: { layoutVersion: number, cases: Record<string, string> } | null,
 *   headVersion: number | null,
 *   baseVersion?: number | null,
 *   baseBaseline?: { cases: Record<string, string> } | null,
 *   partial?: boolean,
 * }} args
 *
 * The verdict. Inputs:
 *   comparison     — compareToBaseline(run, headBaseline)
 *   run            — the merged run (blocked fetches, environment)
 *   headBaseline   — the committed baseline at HEAD (null when missing)
 *   headVersion    — CARD_LAYOUT_VERSION at HEAD
 *   baseVersion    — CARD_LAYOUT_VERSION on the base branch (null: unknown)
 *   baseBaseline   — the base branch's baseline (null: none / unknown)
 * Each case's `stale` (from the bake) is isRenderStale at the version the
 * bake was told is the base's (VISUAL_BASE_VERSION — the same --base);
 * `printOnly` marks a case no stored image is (square print corners).
 * Returns { ok, bumped, reference, widerScope, problems: [{ code, message, ids? }] }.
 */
export function gateVerdict({ comparison, run, headBaseline, headVersion, baseVersion = null, baseBaseline = null, partial = false }) {
  const problems = [];
  const reference = baseVersion ?? headBaseline?.layoutVersion ?? null;
  const bumped = reference !== null && headVersion !== null && headVersion > reference;
  const versionText = bumped ? `CARD_LAYOUT_VERSION ${reference} → ${headVersion}` : `CARD_LAYOUT_VERSION ${headVersion}`;

  if (comparison.errors.length) {
    problems.push({
      code: "render-errors",
      message: `${comparison.errors.length} case(s) failed to bake — fix the renderer or the harness first.`,
      ids: comparison.errors.map((e) => `${e.id}: ${e.error}`),
    });
  }
  if (run.blocked?.length) {
    problems.push({
      code: "not-hermetic",
      message: "The bake asked for something outside the local frame cache (the suite is hermetic by design).",
      ids: run.blocked,
    });
  }
  if (!headBaseline) {
    problems.push({ code: "no-baseline", message: `There is no ${BASELINE_PATH} yet — generate it.` });
  }

  // Square corners (print) are rendered live, never stored: a change there
  // alone needs no bump — the case's round sibling carries any stored change.
  const printOnly = (id) => run.cases[id]?.printOnly === true;
  const changed = comparison.changed;
  const storedChanged = changed.filter((c) => !printOnly(c.id));
  const printChanged = changed.filter((c) => printOnly(c.id));
  if (headBaseline && storedChanged.length && !bumped) {
    problems.push({
      code: "unbumped-change",
      message: `${storedChanged.length} case(s) render differently and ${versionText} was not bumped. A change to stored-card pixels needs the bump + a VERSION_ROLLOUT policy (and a scope, if it touches only some cards) in ${LAYOUT_VERSION_PATH} — then regenerate the baseline. (A change to the harness itself — tests/visual/bake.visual.ts's art or contract — raises VISUAL_HARNESS in tests/visual/matrix.ts instead.)`,
      ids: storedChanged.map((c) => c.id),
    });
  }
  const drift = baselineDrift(headBaseline, baseBaseline).filter((id) => !printOnly(id));
  // What this PR moves: hashes against the committed baseline (before it is
  // regenerated) and the committed baseline against the base branch's
  // (after). With a bump, every one of them must be in the bump's scope.
  const moved = new Set([...storedChanged.map((c) => c.id), ...drift]);
  const widerScope = [];
  if (bumped) {
    if (run.baseVersion != null && run.baseVersion !== reference) {
      problems.push({
        code: "scope-reference",
        message: `The bake judged each case's scope at layout v${run.baseVersion} but the gate's base is v${reference} — give the bake and the gate the same --base.`,
      });
    }
    const outside = [...moved].filter((id) => run.cases[id]?.stale === false).sort();
    if (outside.length) {
      problems.push({
        code: "outside-bump-scope",
        message: `${outside.length} changed case(s) are OUTSIDE v${headVersion}'s scope: a card stamped v${reference} there counts as current, so the sweep would stamp it without re-baking and its stored image would stay old. Widen VERSION_SCOPES / TEMPLATE_SCOPED_VERSIONS[${headVersion}] (or undo the change there).`,
        ids: outside,
      });
    }
    for (const [id, result] of Object.entries(run.cases)) if (result?.stale === true && !result.printOnly && !moved.has(id)) widerScope.push(id);
    widerScope.sort();
  }
  if (headBaseline && changed.length && bumped) {
    problems.push({
      code: "regenerate",
      message: `${versionText}: ${changed.length} case(s) render differently (listed below) — review them, then commit the regenerated baseline in this PR.`,
      ids: changed.map((c) => c.id),
    });
  }
  if (headBaseline && printChanged.length && !bumped) {
    problems.push({
      code: "print-changed",
      message: `${printChanged.length} print-only case(s) render differently — square corners (the PDF, the Square download) are rendered live, never stored, so no layout bump is needed: review them, then commit the regenerated baseline.`,
      ids: printChanged.map((c) => c.id),
    });
  }
  const redefined = comparison.redefined ?? [];
  if (headBaseline && (redefined.length || (!partial && (comparison.added.length || comparison.removed.length)))) {
    problems.push({
      code: "cases-changed",
      message: `The matrix gained ${comparison.added.length}, lost ${comparison.removed.length} and redefined ${redefined.length} case(s) (a redefined case's row, preset or corners changed in tests/visual/matrix.ts) — regenerate the baseline; none of this needs a layout bump.`,
      ids: [...comparison.added.map((id) => `+ ${id}`), ...comparison.removed.map((id) => `- ${id}`), ...redefined.map((id) => `~ ${id}`)],
    });
  }
  if (headBaseline && !changed.length && headVersion !== null && headBaseline.layoutVersion !== headVersion) {
    problems.push({
      code: "baseline-version",
      message: `The baseline was made at layout v${headBaseline.layoutVersion} but CARD_LAYOUT_VERSION is ${headVersion}, and no case changed — regenerate the baseline to restamp it. If this PR bumped for a change, the matrix doesn't draw that change: add a case to tests/visual/matrix.ts that does.`,
    });
  }
  if (drift.length && !bumped) {
    problems.push({
      code: "unbumped-regeneration",
      message: `The committed baseline changes ${drift.length} hash(es) against the base branch's, but ${versionText} was not bumped — regenerating the baseline is not a way around the bump.`,
      ids: drift,
    });
  }
  return { ok: problems.length === 0, bumped, reference, widerScope, problems };
}

/** The baseline file for a run: hashes only, keys sorted, one per line. */
export function serializeBaseline(run, layoutVersion) {
  const cases = {};
  for (const id of Object.keys(run.cases).sort()) {
    const { hash, input, error } = run.cases[id];
    if (error || !hash) throw new Error(`Refusing to write a baseline: ${id} failed to bake (${error ?? "no hash"}).`);
    cases[id] = input ? `${hash}:${input}` : hash;
  }
  const { platform, node, satori, sharp, libvips, rsvg, cairo, pixman, fonts, manifest } = run.environment ?? {};
  const body = {
    about:
      "Visual-regression baseline (TODO 7.1): every case in tests/visual/matrix.ts as <pixel hash>:<input fingerprint> (the case's row, preset and corners). Generated — never edit by hand; `npm run test:visual -- --update` (or the CI job's visual-baseline artifact) rewrites it. Hashes only: no pixels, no frame art.",
    layoutVersion,
    generatedOn: { platform, node, satori, sharp, libvips, rsvg, cairo, pixman },
    inputs: { fonts, manifest },
    cases,
  };
  return `${JSON.stringify(body, null, 2)}\n`;
}

/** What differs between the run's tools/inputs and the baseline's (the
 *  usual reason EVERY case changes at once). */
export function environmentDrift(run, baseline) {
  if (!baseline) return [];
  const now = run.environment ?? {};
  const was = { ...(baseline.generatedOn ?? {}), ...(baseline.inputs ?? {}) };
  const out = [];
  for (const key of ["platform", "node", "satori", "sharp", "libvips", "rsvg", "cairo", "pixman", "manifest"]) {
    if (was[key] !== undefined && now[key] !== undefined && was[key] !== now[key]) out.push(`${key}: ${was[key]} → ${now[key]}`);
  }
  for (const [file, hash] of Object.entries(now.fonts ?? {})) {
    const before = was.fonts?.[file];
    if (before && before !== hash) out.push(`font ${file}: ${before} → ${hash}`);
  }
  return out;
}

/**
 * The commands that regenerate the baseline.
 * @param {Record<string, string | undefined>} [env]
 */
export function regenerateCommands(env = process.env) {
  const lines = ["npm run test:visual -- --update   # then commit tests/visual/baseline.json"];
  if (env.GITHUB_RUN_ID && env.GITHUB_REPOSITORY) {
    lines.push(
      `gh run download ${env.GITHUB_RUN_ID} -R ${env.GITHUB_REPOSITORY} -n visual-baseline -D tests/visual   # this CI run's baseline, made on its runner`,
    );
  }
  return lines;
}

/** Group ids by template ("m15/r/creature-short" → "m15") for the summary. */
export function countByTemplate(ids) {
  const counts = new Map();
  for (const id of ids) {
    const template = id.split("/")[0];
    counts.set(template, (counts.get(template) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
}

/**
 * The report (markdown — the CI step summary and the console).
 * @param {{
 *   verdict: ReturnType<typeof gateVerdict>,
 *   comparison: ReturnType<typeof compareToBaseline>,
 *   run: { cases: Record<string, { stale?: boolean, printOnly?: boolean }>, seconds: number, environment?: Record<string, any> },
 *   headBaseline: { layoutVersion: number, generatedOn?: Record<string, any>, inputs?: Record<string, any> } | null,
 *   headVersion: number | null,
 *   env?: Record<string, string | undefined>,
 *   maxIds?: number,
 * }} args
 */
export function formatReport({ verdict, comparison, run, headBaseline, headVersion, env = process.env, maxIds = 150 }) {
  const out = [];
  const total = Object.keys(run.cases).length;
  out.push(`## Visual regression — ${verdict.ok ? "✅ no pixel changes" : "❌ attention needed"}`);
  out.push("");
  out.push(
    `${total} case(s) baked in ${Math.round(run.seconds)} s on ${run.environment?.platform ?? "?"} · layout v${headVersion}` +
      (headBaseline ? ` · baseline v${headBaseline.layoutVersion} (${headBaseline.generatedOn?.platform ?? "?"})` : " · no baseline") +
      ` · ${comparison.unchanged} unchanged, ${comparison.changed.length} changed, ${comparison.added.length} new, ${comparison.removed.length} removed, ${comparison.redefined?.length ?? 0} redefined, ${comparison.errors.length} failed`,
  );
  const drift = environmentDrift(run, headBaseline);
  if (drift.length && comparison.changed.length) {
    out.push("");
    out.push(`Tools or inputs differ from the baseline's (a change here moves many cases at once): ${drift.join("; ")}.`);
  }
  for (const problem of verdict.problems) {
    out.push("");
    out.push(`### ${problem.code}`);
    out.push(problem.message);
    if (problem.ids?.length) {
      if (problem.ids.length > 20) {
        out.push("");
        out.push(`By template: ${countByTemplate(problem.ids.map((i) => i.replace(/^[+~-] /, ""))).map(([t, n]) => `${t} ${n}`).join(", ")}`);
      }
      out.push("");
      out.push("```");
      for (const id of problem.ids.slice(0, maxIds)) {
        const c = comparison.changed.find((x) => x.id === id);
        // The scope mark means something only when this PR bumped, and never
        // for a print-only case (no stored image to re-bake).
        const stale = run.cases[id]?.stale;
        const scope = run.cases[id]?.printOnly
          ? "  (print only — never stored)"
          : typeof stale !== "boolean" || !verdict.bumped
            ? ""
            : stale
              ? "  (in the bump's scope)"
              : "  (NOT in the bump's scope)";
        out.push(c ? `${id}  ${c.from} → ${c.to}${scope}` : `${id}${scope}`);
      }
      if (problem.ids.length > maxIds) out.push(`… and ${problem.ids.length - maxIds} more (tmp/visual/report.json)`);
      out.push("```");
    }
  }
  if (verdict.problems.some((p) => ["regenerate", "print-changed", "cases-changed", "baseline-version", "no-baseline"].includes(p.code))) {
    out.push("");
    out.push("Regenerate:");
    out.push("```");
    for (const line of regenerateCommands(env)) out.push(line);
    out.push("```");
  }
  if (verdict.widerScope.length) {
    out.push("");
    out.push(
      `Note: ${verdict.widerScope.length} unchanged case(s) are inside v${headVersion}'s scope (they would re-bake to the same pixels) — fine, but a tighter scope saves sweep work.`,
    );
  }
  return `${out.join("\n")}\n`;
}
