import { describe, expect, it } from "vitest";
import { z } from "zod";
import referencesData from "@/lib/cards/frame-references.json";
import {
  FRAME_COLOR_KEYS,
  FRAME_REFERENCES,
  findFrameReference,
  frameReferenceNote,
  frameReferenceOptions,
  referenceTierLabel,
} from "@/lib/cards/frame-reference-registry";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// lib/cards/frame-references.json is the compare tool's ground truth: every
// template × colour lists the printings it is verified against, default
// first. A typo here silently points a verification at the wrong card, so
// the shape, the ids and the coverage are pinned.
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const referenceSchema = z
  .object({
    name: z.string().min(1),
    set: z.string().min(2).max(6),
    scryfallId: z.string().regex(UUID),
    tier: z.union([z.literal(1), z.literal(2)]).optional(),
    /** Hand-researched against a highres scan (2026-07-01) rather than found by the script. */
    curated: z.literal(true).optional(),
  })
  .strict();

const templateSchema = z
  .object({
    note: z.string().min(1).optional(),
    confirm: z.literal(true).optional(),
    colors: z.object(
      Object.fromEntries(
        FRAME_COLOR_KEYS.map((key) => [key, z.array(referenceSchema).min(1).nullable()]),
      ),
    ).strict(),
  })
  .strict();

// Combos with no real printing — a null here is documented, anything else
// null is a hole in the research.
const DOCUMENTED_NULLS = new Set([
  "m15tokenartifact/g",
  "adventure/c",
  "split/w", "split/u", "split/b", "split/r", "split/g", "split/c",
  "aftermath/c",
  "flip/c", "flip/m",
  "alphatoken/w", "alphatoken/u", "alphatoken/b", "alphatoken/r", "alphatoken/g", "alphatoken/c", "alphatoken/m",
  "fullart/c",
  "fullartland/m",
  "m15textless/u",
  "m15textlessland/c", "m15textlessland/m",
  "expeditionland/w", "expeditionland/u", "expeditionland/b", "expeditionland/r", "expeditionland/g",
  "nyx/c",
  "lotr/c",
  "bloomburrow/c",
  "tarkirdragon/u", "tarkirdragon/b", "tarkirdragon/r", "tarkirdragon/g", "tarkirdragon/c",
  "tarkirghostfire/u", "tarkirghostfire/b",
]);

describe("frame-references.json", () => {
  const data = referencesData as Record<string, unknown>;

  it("has exactly one entry per frame template and nothing else", () => {
    expect(Object.keys(data).sort()).toEqual([...FRAME_TEMPLATE_VALUES].sort());
  });

  for (const template of FRAME_TEMPLATE_VALUES) {
    it(`${template}: well-formed, unique ids, documented nulls`, () => {
      const parsed = templateSchema.safeParse(data[template]);
      expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
      if (!parsed.success) return;
      for (const key of FRAME_COLOR_KEYS) {
        const list = parsed.data.colors[key];
        const combo = `${template}/${key}`;
        if (list === null) {
          expect(DOCUMENTED_NULLS.has(combo), `${combo} is null but not documented`).toBe(true);
          continue;
        }
        expect(DOCUMENTED_NULLS.has(combo), `${combo} is documented null but has references`).toBe(false);
        const ids = list.map((ref) => ref.scryfallId);
        expect(new Set(ids).size).toBe(ids.length);
      }
    });
  }

  it("keeps the hand-researched M15 defaults first", () => {
    expect(FRAME_REFERENCES.m15.w?.name).toBe("Serra Angel");
    expect(FRAME_REFERENCES.m15.c?.name).toBe("Ulamog, the Ceaseless Hunger");
    expect(FRAME_REFERENCES.saga.m?.name).toBe("The Kami War // O-Kagachi Made Manifest");
    expect(FRAME_REFERENCES.battle.w?.name).toMatch(/^Invasion of Gobakhan/);
  });

  it("gives most combos an alternate printing", () => {
    let withAlternates = 0;
    let total = 0;
    for (const template of FRAME_TEMPLATE_VALUES) {
      for (const key of FRAME_COLOR_KEYS) {
        const options = frameReferenceOptions(template, key);
        if (options.length === 0) continue;
        total += 1;
        if (options.length > 1) withAlternates += 1;
        expect(FRAME_REFERENCES[template][key]).toEqual(options[0]);
      }
    }
    expect(total).toBeGreaterThan(200);
    expect(withAlternates / total).toBeGreaterThan(0.8);
  });
});

describe("registry helpers", () => {
  it("findFrameReference only accepts ids the combo lists", () => {
    const [first] = frameReferenceOptions("m15", "w");
    expect(findFrameReference("m15", "w", first.scryfallId)).toEqual(first);
    expect(findFrameReference("m15", "u", first.scryfallId)).toBeNull();
    expect(findFrameReference("m15", "w", "not-an-id")).toBeNull();
    expect(findFrameReference("m15", "w", null)).toBeNull();
  });

  it("flags the families a human must confirm and explains the scan tiers", () => {
    expect(frameReferenceNote("bloomburrow").confirm).toBe(true);
    expect(frameReferenceNote("m15").confirm).toBe(false);
    expect(frameReferenceNote("split").note).toMatch(/never printed/);
    expect(referenceTierLabel({ name: "x", set: "y", scryfallId: "z" })).toBeNull();
    expect(referenceTierLabel({ name: "x", set: "y", scryfallId: "z", tier: 1 })).toMatch(/low-resolution/);
    expect(referenceTierLabel({ name: "x", set: "y", scryfallId: "z", tier: 2 })).toMatch(/foil/);
  });
});
