import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  ART_WINDOW_KNOWN_FAILURES,
  artWindowFindings,
  artWindowSlotsOf,
  artWindowVerdict,
  isKnownArtWindowFailure,
  type ArtWindowSlot,
} from "@/lib/frames/art-window";
import manifestJson from "@/lib/frames/frame-manifest.json";
import { FRAME_MASTER_KEYS } from "@/lib/cards/frame-reference-registry";
import { getFrameProfile, underFrameArtRect, underFrameArtSlot } from "@/lib/cards/template-layout";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 7.6 — the art-window check on every template × colour master, shared by
// art-window-coverage.test.ts (the check itself, the known-failure table, the
// importer, CI's fetch — and the proof that the parts below are the whole
// list) and art-window-coverage-<n>.test.ts (the masters, in PARTS files).
//
// WHY PARTS. The per-master tests were one block of one file. Vitest runs a
// FILE on one worker, and under CI's V8 coverage the check's pixel loops run
// ~9× slower (measured 2026-10-12, the six-master sample of the PR: 26 ms →
// 230 ms a master with block coverage on before the module loads; the four
// loops — fillRegion, translucentMask, seeThroughWindow, seeThroughBody — are
// 90 % of it; the PNG decode is native and unchanged). V8's coverage is a
// switch on the whole process, so `coverage.exclude` only filters the REPORT:
// leaving lib/frames out of it changed nothing (133 s → 155 s for the block,
// within noise). That one file therefore took 5.5 to 7.5 minutes in CI and
// was the floor of its unit shard whatever the shard count. In PARTS files
// the same tests run side by side on a runner's workers and spread over the
// shards by vitest's own hash of each file's path.
//
// THE RULE: template i of FRAME_TEMPLATE_VALUES belongs to part
// (i mod PARTS) + 1 — every template in exactly one part, nothing to keep by
// hand; a new template lands in a part by its place in the list. A part's
// file is three lines; what it registers is `artWindowMasterPlan` of its
// templates, the same function the union test reads.
// ---------------------------------------------------------------------------

/** How many files the per-master tests are split over. Changing it means
 *  adding or removing art-window-coverage-<n>.test.ts files to match (the
 *  union test in art-window-coverage.test.ts names the ones it expects). */
export const ART_WINDOW_MASTER_PARTS = 4;

const manifest = manifestJson as { files: Record<string, { sha256: string }> };
const ROOT = process.cwd();
const PUBLIC = path.join(ROOT, "public", "frames");
export const BUILD = process.env.FRAMES_BUILD_DIR ? path.resolve(process.env.FRAMES_BUILD_DIR) : path.join(ROOT, ".frames-build");
/** CI, with the fetched masters: a bucket master that isn't there is a failure. */
export const STRICT = Boolean(process.env.CI && process.env.FRAMES_BUILD_DIR);

export type Master = { template: string; key: string; file: string; bucket: boolean };

/** Every master of `template`: git ones from public/frames, bucket ones from
 *  BUILD when their bytes are the manifest's. `missing` lists the bucket
 *  masters the manifest has and BUILD doesn't (at that sha). */
export function mastersOf(template: string): { masters: Master[]; missing: string[] } {
  const masters: Master[] = [];
  const missing: string[] = [];
  for (const key of FRAME_MASTER_KEYS) {
    const rel = `${template}/${key}.png`;
    const entry = manifest.files[rel];
    if (entry) {
      const file = path.join(BUILD, rel);
      const ok = fs.existsSync(file) && createHash("sha256").update(fs.readFileSync(file)).digest("hex") === entry.sha256;
      if (ok) masters.push({ template, key, file, bucket: true });
      else missing.push(rel);
      continue;
    }
    const file = path.join(PUBLIC, rel);
    if (fs.existsSync(file)) masters.push({ template, key, file, bucket: false });
  }
  return { masters, missing };
}

async function rgbaOf(file: string) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** The slots the renderers paint for this master (the check's input). */
export function slotsFor(template: string, key: string): ArtWindowSlot[] {
  const profile = getFrameProfile(template);
  return artWindowSlotsOf(profile, underFrameArtRect(profile, key), underFrameArtSlot(profile, key));
}

/** The templates of part `part` (1-based) of `parts`. */
export function artWindowTemplatesOfPart(part: number, parts = ART_WINDOW_MASTER_PARTS): string[] {
  if (!Number.isInteger(part) || part < 1 || part > parts) throw new Error(`no part ${part} of ${parts}`);
  return FRAME_TEMPLATE_VALUES.filter((_, i) => i % parts === part - 1);
}

/** One test the per-master block registers. */
export type PlannedMasterTest =
  | { kind: "unavailable"; template: string; title: string }
  | { kind: "git-count"; template: string; title: string; masters: number }
  | { kind: "master"; template: string; title: string; master: Master };

/** The tests of `templates`, in order — what the single file registered for
 *  all of FRAME_TEMPLATE_VALUES, and what a part registers for its own. */
export function artWindowMasterPlan(templates: readonly string[]): PlannedMasterTest[] {
  const bucketTemplates = new Set(Object.keys(manifest.files).map((k) => k.split("/")[0]));
  const plan: PlannedMasterTest[] = [];
  for (const template of templates) {
    const { masters, missing } = mastersOf(template);
    if (missing.length && !STRICT) {
      // A bucket template without a local copy: CI fetches it; locally run
      // `node scripts/frames-fetch.mjs` and set FRAMES_BUILD_DIR=.frames-cache.
      plan.push({ kind: "unavailable", template, title: `${template}: ${missing.length} bucket master(s) not available here (set FRAMES_BUILD_DIR)` });
    }
    if (!bucketTemplates.has(template)) {
      plan.push({ kind: "git-count", template, title: `${template}: every colour master is checked (git)`, masters: masters.length });
    }
    for (const master of masters) {
      const known = isKnownArtWindowFailure(template, master.key);
      const todo = known ? ` — known failure (TODO ${ART_WINDOW_KNOWN_FAILURES[template].todo.join(", ")})` : "";
      plan.push({ kind: "master", template, title: `${template}/${master.key}${master.bucket ? " (bucket)" : ""}${todo}`, master });
    }
  }
  return plan;
}

/** Registers part `part`'s tests — the whole body of art-window-coverage-<part>.test.ts. */
export function describeArtWindowMasters(part: number): void {
  describe(`every frame master's art window is covered by the art that fills it — part ${part} of ${ART_WINDOW_MASTER_PARTS}`, () => {
    for (const planned of artWindowMasterPlan(artWindowTemplatesOfPart(part))) {
      if (planned.kind === "unavailable") {
        it.skip(planned.title, () => {});
      } else if (planned.kind === "git-count") {
        it(planned.title, () => {
          // The expeditionland b/g lesson (2026-09-26): never sample one colour.
          expect(planned.masters).toBeGreaterThanOrEqual(7);
        });
      } else {
        const { template, key, file } = planned.master;
        // Decode + fills on a 3 Mpx master: a generous timeout for CI's V8 coverage.
        it(planned.title, { timeout: 20_000 }, async () => {
          const { data, width, height } = await rgbaOf(file);
          expect([width, height]).toEqual(getFrameProfile(template).orientation === "landscape" ? [2100, 1500] : [1500, 2100]);
          const verdict = artWindowVerdict(template, key, artWindowFindings(data, width, height, slotsFor(template, key)));
          expect(verdict.fails).toEqual([]);
          expect(verdict.fixed, "it passes now — strike it from ART_WINDOW_KNOWN_FAILURES and close its TODO item").toBe(false);
        });
      }
    }
  });
}
