import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveFrameProfile, type FrameProfileOverridesMap } from "@/lib/cards/profile-override";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// Profile equivalence (TODO 4.5.0, proof 1). tests/unit/cards/fixtures/
// profiles-base.json is every template's getFrameProfile() and
// resolveFrameProfile(t, sampleOverrides), key-sorted, as
// scripts/dump-frame-profiles.mjs wrote it at the base of 4.5.0 (the commit
// is in the file; `resolved` holds the templates the sample overrides —
// every other one must resolve to its plain profile). Both renderers read a card's layout only through its
// profile and its master path, so a profile that deep-equals the base draws
// the same pixels for EVERY stored card — private ones included, which no
// corpus replay can reach. 4.5.0 rewrote M15PW and the borderless walkers
// through walkerAnatomy() (lib/cards/kind-anatomy.ts); this proves the
// rewrite changed no number, no colour and no path.
//
// A PR that MEANS to change a profile (a new template, a moved rect under a
// layout bump) regenerates the fixture on its own tree —
// `node scripts/dump-frame-profiles.mjs` — and says why in the PR: the
// fixture diff IS the profile change, for review. `--check` compares
// without writing. Keys no renderer reads (RENDERER_BLIND_KEYS, design §6:
// pickerSampleArt) are left out on both sides.
// ---------------------------------------------------------------------------

type Fixture = {
  base: string;
  templates: number;
  sampleOverrides: FrameProfileOverridesMap;
  profiles: Record<string, unknown>;
  resolved: Record<string, unknown>;
};

const fixture = JSON.parse(
  readFileSync(join(process.cwd(), "tests/unit/cards/fixtures/profiles-base.json"), "utf8"),
) as Fixture;

/** scripts/dump-frame-profiles.mjs RENDERER_BLIND_KEYS — keep in step. */
const RENDERER_BLIND_KEYS = ["pickerSampleArt"];

const REGENERATE =
  "the profile changed. If the PR means it (a new template, a moved rect under its layout bump), regenerate tests/unit/cards/fixtures/profiles-base.json with `node scripts/dump-frame-profiles.mjs` and say why in the PR; if it doesn't, the refactor moved a value";

/** The dump's own normal form: keys sorted, undefined dropped. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .filter((k) => record[k] !== undefined)
        .map((k) => [k, canonical(record[k])]),
    );
  }
  return value;
}

/** A profile as the fixture holds it (the dump's profileView). */
function profileView(profile: unknown): unknown {
  const view = canonical(profile) as Record<string, unknown>;
  for (const key of RENDERER_BLIND_KEYS) delete view[key];
  return view;
}

describe("every frame profile deep-equals its 4.5.0 base", () => {
  it("covers exactly today's templates", () => {
    expect(Object.keys(fixture.profiles).sort()).toEqual([...FRAME_TEMPLATE_VALUES].sort());
    expect(fixture.templates).toBe(FRAME_TEMPLATE_VALUES.length);
  });

  it.each(FRAME_TEMPLATE_VALUES)("%s: getFrameProfile is unchanged", (template) => {
    expect(profileView(getFrameProfile(template)), `${template}: ${REGENERATE}`).toEqual(fixture.profiles[template]);
  });

  it.each(Object.keys(fixture.sampleOverrides))("%s: resolveFrameProfile with its sample override is unchanged", (template) => {
    expect(fixture.resolved[template]).toBeDefined();
    expect(profileView(resolveFrameProfile(template, fixture.sampleOverrides)), `${template}: ${REGENERATE}`).toEqual(
      fixture.resolved[template],
    );
  });

  it("an override on one template never reaches another's resolved profile", () => {
    const overridden = new Set(Object.keys(fixture.sampleOverrides));
    // The sample overrides the walker body m15pw, not the borderless walkers
    // built with the same builder, nor anything spread from it.
    expect(overridden.has("m15pw")).toBe(true);
    for (const template of FRAME_TEMPLATE_VALUES) {
      if (overridden.has(template)) continue;
      expect(profileView(resolveFrameProfile(template, fixture.sampleOverrides)), template).toEqual(
        fixture.profiles[template],
      );
    }
    // …and resolving never edits the shared (frozen) anatomy it merged over.
    const before = canonical(getFrameProfile("m15borderlesspw"));
    resolveFrameProfile("m15borderlesspw", { m15borderlesspw: { loyalty: { rect: { leftPct: 1 } } } });
    expect(canonical(getFrameProfile("m15borderlesspw"))).toEqual(before);
  });
});
