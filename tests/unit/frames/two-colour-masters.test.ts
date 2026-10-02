import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import manifestJson from "@/lib/frames/frame-manifest.json";
import { CC_TEMPLATES, borderlessPairLayers, describeLayer, pairMasterLayers } from "@/scripts/lib/cc-frames.mjs";
import {
  FRAME_MASTER_KEYS,
  TWO_COLOR_MASTER_KEYS,
  TWO_COLOR_PAIRS,
  sampleFramePreview,
} from "@/lib/cards/frame-reference-registry";
import { frameMasterKey } from "@/components/cards/frame-layer";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { FRAME_TEMPLATE_VALUES, type ColorIdentity, type FrameStyle } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.6b — the two-colour pair masters a profile declares are PUBLISHED:
// every template whose PROFILES entry has `twoColorMasters` has a bucket
// master (PNG + WebP, 1500 × 2100) for every pair of every dress it declares
// — gold-split `<pair>`, hybrid `<pair>-h` — built by the Card Conjurer
// importer from the recipe provenance records. A dress declared without its
// masters would bake a transparent frame; masters without a declaration
// are dead weight in the bucket.
// ---------------------------------------------------------------------------

type Entry = { hash: string; sha256: string; bytes: number; width: number; height: number };
const files = (manifestJson as { files: Record<string, Entry> }).files;
const provenance = JSON.parse(readFileSync("lib/cards/frame-sources.json", "utf8")) as Record<
  string,
  { colors: Record<string, string[]> }
>;

const KIND: Record<string, "m15" | "artifact" | "land"> = { m15: "m15", m15artifact: "artifact", m15land: "land" };
/** The templates whose pairs the Card Conjurer importer builds, and the
 *  recipe each reads: m15 / m15artifact / m15land through pairMasterLayers
 *  (4.6b), the borderless dresses through borderlessPairLayers (4.6f). */
const PAIR_TEMPLATES = ["m15", "m15artifact", "m15land", "m15borderless", "m15borderlessartifact"] as const;
function recipeOf(template: string, key: string) {
  const [pair, hybrid] = key.split("-");
  const dress = hybrid ? "hybrid" : "split";
  return KIND[template] ? pairMasterLayers(pair, dress, KIND[template]) : borderlessPairLayers(pair, dress);
}

function declaredKeys(template: string): string[] {
  return (getFrameProfile(template).twoColorMasters ?? []).flatMap((dress) =>
    TWO_COLOR_PAIRS.map((pair) => (dress === "hybrid" ? `${pair}-h` : pair)),
  );
}

describe("the declared pair masters", () => {
  it("are 40 in wave 1 (m15 gold-split + hybrid, m15artifact and m15land gold-split) and 30 more in wave 2a (the borderless pinline split, and m15borderless's hybrid)", () => {
    const declared = Object.fromEntries(
      FRAME_TEMPLATE_VALUES.map((t) => [t, declaredKeys(t).length] as const).filter(([, n]) => n > 0),
    );
    expect(declared).toEqual({ m15: 20, m15land: 10, m15artifact: 10, m15borderless: 20, m15borderlessartifact: 10 });
    // Every pair key is a master key the bake's loader knows (never "c").
    for (const key of TWO_COLOR_MASTER_KEYS) expect(FRAME_MASTER_KEYS as readonly string[]).toContain(key);
  });

  it.each(PAIR_TEMPLATES)("%s: each is in the frames bucket, PNG + WebP, full size", (template) => {
    for (const key of declaredKeys(template)) {
      const png = files[`${template}/${key}.png`];
      expect(png, `${template}/${key}.png`).toBeDefined();
      expect([png.width, png.height], `${template}/${key}`).toEqual([1500, 2100]);
      expect(files[`${template}/${key}.webp`], `${template}/${key}.webp`).toBeDefined();
    }
  });

  it("no template has a pair master it doesn't declare", () => {
    for (const key of Object.keys(files)) {
      const [template, name] = key.split("/");
      // Frame templates only: an overlay folder (4.6a's m15crown/<pair>.png
      // crown bands) is no frame master.
      if (!(FRAME_TEMPLATE_VALUES as readonly string[]).includes(template)) continue;
      const master = name?.replace(/\.(png|webp)$/, "");
      if (!master || !(TWO_COLOR_MASTER_KEYS as readonly string[]).includes(master) || key.split("/").length !== 2) continue;
      expect(declaredKeys(template), key).toContain(master);
    }
  });

  it.each(PAIR_TEMPLATES)("%s: provenance records the importer's recipe for each", (template) => {
    for (const key of declaredKeys(template)) {
      const layers = recipeOf(template, key);
      expect(provenance[template].colors[key], `${template}/${key}`).toEqual(layers.map(describeLayer));
      expect((CC_TEMPLATES as Record<string, { colors: Record<string, unknown> }>)[template].colors[key]).toEqual(layers);
    }
  });
});

describe("verification (owner decision 2026-09-29, V-A: a pair rides its template's m tick)", () => {
  it.each(PAIR_TEMPLATES)(
    "%s: the compare page's m sample stays the GOLD master — an m re-tick never judges a pair by accident",
    (template) => {
      const sample = sampleFramePreview(template, "m");
      const profile = getFrameProfile(template);
      const style = sample.frameStyle as FrameStyle;
      expect(style).not.toHaveProperty("twoColor");
      expect(frameMasterKey(profile, sample.colorIdentity as ColorIdentity[], sample, style)).toBe("m");
    },
  );
});

