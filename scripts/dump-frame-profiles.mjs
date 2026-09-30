#!/usr/bin/env node
// ---------------------------------------------------------------------------
// dump-frame-profiles.mjs — READ-ONLY snapshot of every frame profile (TODO
// 4.5.0's first proof). Writes, as key-sorted JSON:
//
//   * `profiles`: getFrameProfile(t) for every template in
//     FRAME_TEMPLATE_VALUES — the code profile both renderers resolve,
//     less the keys no renderer reads (RENDERER_BLIND_KEYS);
//   * `sampleOverrides` + `resolved`: resolveFrameProfile(t, sampleOverrides)
//     for the templates the sample overrides — the admin override merge. The
//     test resolves every OTHER template with the same map and expects its
//     plain profile: an override never leaks into another's profile;
//   * `base`: the commit it was generated at (git HEAD, plus "+dirty" when
//     the tree has uncommitted changes to lib/ or types/).
//
// tests/unit/cards/profile-refactor-baseline.test.ts deep-equals the current
// profiles against the file. A pure refactor of the profiles (4.5.0's
// walkerAnatomy()) leaves it untouched; a change a PR MEANS (a new template,
// a moved rect under its layout bump) regenerates it on the PR's own tree
// and says why in the PR — the fixture diff is the profile change, for the
// reviewer to read. A PR that must PROVE a refactor after rebasing onto a
// main that moved a profile regenerates it on the new BASE (a detached
// worktree at the merge base), never on the branch, and re-runs --check:
//
//   node scripts/dump-frame-profiles.mjs              # rewrite the fixture
//   node scripts/dump-frame-profiles.mjs --out <file> # write elsewhere
//   node scripts/dump-frame-profiles.mjs --check      # exit 1 if it differs
//
// It imports the app's TypeScript through Node's type stripping
// (scripts/lib/ts-alias-hooks.mjs) and touches nothing but the output file:
// no network, no database.
// ---------------------------------------------------------------------------
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import "./lib/ts-alias-hooks.mjs";
import { REPO_ROOT } from "./lib/ts-alias-hooks.mjs";

export const DEFAULT_OUT = path.join(REPO_ROOT, "tests/unit/cards/fixtures/profiles-base.json");

/**
 * The admin overrides the fixture resolves every template with: a nudge on
 * each kind's anatomy slot (the walker shield and rules box, the P/T plate,
 * the defense badge, the chapter rail, a second face) on SOME templates, so
 * the others prove the merge never reaches past its own key. Values stay
 * inside frameProfileOverrideSchema's ranges.
 */
export const SAMPLE_OVERRIDES = {
  m15: { pt: { rect: { topPct: 88.6 }, valueDyEm: -0.05 }, title: { sizePct: 0.05 } },
  m15pw: {
    loyalty: { rect: { leftPct: 80.8 }, sizePct: 0.05 },
    rules: { rect: { topPct: 63.3, heightPct: 28.1 }, lineHeight: 1.1 },
  },
  m15borderlesspw: { loyalty: { valueDxEm: 0.02 }, rules: { sizePct: 0.03 } },
  battle: { defense: { rect: { topPct: 80 }, valueDyEm: 0.1 } },
  saga: { chapters: { rect: { heightPct: 50 }, sizePct: 0.03 } },
  flip: { secondFace: { pt: { rect: { leftPct: 10 } } } },
  lotr: { artSlot: { heightPct: 50 }, pt: { sizePct: 0.04 } },
};

/**
 * Profile keys no renderer reads (design 2026-09-29 §6): `pickerSampleArt`
 * only tells the creator's frame picker to show sample art on its tile. Left
 * out of the snapshot, so a picker-only change never needs a regenerated
 * fixture. (4.6's `overlays` / `twoColorMasters` are left out when unset:
 * canonical() drops undefined.) Keep in step with
 * tests/unit/cards/profile-refactor-baseline.test.ts.
 */
export const RENDERER_BLIND_KEYS = ["pickerSampleArt"];

/** A profile as the snapshot holds it: canonical, renderer-blind keys out. */
export function profileView(profile) {
  const view = canonical(profile);
  for (const key of RENDERER_BLIND_KEYS) delete view[key];
  return view;
}

/** JSON-safe, with every object's keys sorted (a field's position in a
 *  spread is not part of the profile). */
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((k) => value[k] !== undefined)
        .map((k) => [k, canonical(value[k])]),
    );
  }
  return value;
}

function baseRef() {
  try {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain", "--", "lib", "types"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
    return dirty ? `${sha}+dirty` : sha;
  } catch {
    return "unknown";
  }
}

export async function dumpFrameProfiles() {
  const { FRAME_TEMPLATE_VALUES } = await import("../types/card.ts");
  const { getFrameProfile } = await import("../lib/cards/template-layout.ts");
  const { resolveFrameProfile } = await import("../lib/cards/profile-override.ts");
  const profiles = {};
  const resolved = {};
  for (const template of FRAME_TEMPLATE_VALUES) {
    profiles[template] = profileView(getFrameProfile(template));
    if (template in SAMPLE_OVERRIDES) resolved[template] = profileView(resolveFrameProfile(template, SAMPLE_OVERRIDES));
  }
  return {
    comment:
      "Generated by scripts/dump-frame-profiles.mjs — every template's getFrameProfile() and, for the templates sampleOverrides names, resolveFrameProfile(t, sampleOverrides), key-sorted, renderer-blind keys (pickerSampleArt) left out. tests/unit/cards/profile-refactor-baseline.test.ts deep-equals the code against it (TODO 4.5.0). A PR that MEANS to change a profile regenerates it (node scripts/dump-frame-profiles.mjs) and says why.",
    base: baseRef(),
    templates: FRAME_TEMPLATE_VALUES.length,
    sampleOverrides: canonical(SAMPLE_OVERRIDES),
    profiles,
    resolved,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const args = process.argv.slice(2);
  const outAt = args.indexOf("--out");
  const out = outAt >= 0 ? path.resolve(args[outAt + 1]) : DEFAULT_OUT;
  const dump = await dumpFrameProfiles();
  if (args.includes("--check")) {
    const current = JSON.parse(fs.readFileSync(out, "utf8"));
    const same =
      JSON.stringify(current.profiles) === JSON.stringify(dump.profiles) &&
      JSON.stringify(current.resolved) === JSON.stringify(dump.resolved) &&
      JSON.stringify(current.sampleOverrides) === JSON.stringify(dump.sampleOverrides);
    console.log(same ? `profiles match ${path.relative(REPO_ROOT, out)} (base ${current.base})` : `profiles DIFFER from ${path.relative(REPO_ROOT, out)}`);
    process.exit(same ? 0 : 1);
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(dump, null, 1)}\n`);
  console.log(`wrote ${path.relative(REPO_ROOT, out)}: ${dump.templates} templates at ${dump.base}`);
}
