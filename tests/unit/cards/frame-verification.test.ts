import { describe, expect, it } from "vitest";

import {
  FRAME_COLOR_KEYS,
  FRAME_REFERENCES,
  frameComboKey,
  referenceThumbUrl,
  sampleFramePreview,
} from "@/lib/cards/frame-reference-registry";
import {
  isFrameComboAvailable,
} from "@/lib/cards/frame-availability";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { eraForTemplate } from "@/lib/creator/frame-picker";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("frame reference registry", () => {
  it("covers every template × color combination", () => {
    for (const template of FRAME_TEMPLATE_VALUES) {
      const row = FRAME_REFERENCES[template];
      expect(row, template).toBeDefined();
      for (const colorKey of FRAME_COLOR_KEYS) {
        expect(row[colorKey] !== undefined, `${template}/${colorKey}`).toBe(
          true,
        );
      }
    }
  });

  it("every M15-era standard combo has a real reference", () => {
    // The fully researched set (2026-07-01). Combos documented as having no
    // real printing are allowed to be null.
    // TODO 4.49's re-pin (2026-09-29) keeps the arch token frames to the
    // 2014–19 arch prints: no textless gold token, and a coloured arch
    // artifact token in blue only (TC18 #7); the nulls are documented in
    // tests/unit/cards/frame-references-data.test.ts too.
    const noRealPrinting = new Set([
      "m15token/m",
      "m15tokenartifact/w",
      "m15tokenartifact/b",
      "m15tokenartifact/r",
      "m15tokenartifact/m",
      "adventure/c",
      "split/w",
      "split/u",
      "split/b",
      "split/r",
      "split/g",
      "split/c",
      "flip/c",
      "flip/m",
      "aftermath/c",
      // No gold // gold aftermath exists (TODO 4.26's per-part colour): its
      // HOU stand-ins left the registry with layout v39 (4.21a follow-up).
      "aftermath/m",
      "m15tokenartifact/g",
      // 4.49 (b)'s text-box arch artifact token: blue (TC16 #9, TC18 #8)
      // and colourless only.
      "m15tokenartifacttext/w",
      "m15tokenartifacttext/b",
      "m15tokenartifacttext/r",
      "m15tokenartifacttext/g",
      "m15tokenartifacttext/m",
      // 4.52's emblem: colourless by rule (CR 114), so `c` only.
      "emblem/w",
      "emblem/u",
      "emblem/b",
      "emblem/r",
      "emblem/g",
      "emblem/m",
      // 4.48 / 4.50's full-art tokens (Scryfall 2026-09-29, heights measured
      // on the prints): no red, colourless or three-colour tall token
      // outside a legend; no black (bar T40K's own layout), green or gold
      // textless artifact token; no green or gold text-box one; only
      // colourless tall artifact tokens (Map, MKM's Clues).
      "m20tokentall/r",
      "m20tokentall/c",
      "m20tokentall/m",
      "m20tokenartifact/b",
      "m20tokenartifact/g",
      "m20tokenartifact/m",
      "m20tokenartifacttext/g",
      "m20tokenartifacttext/m",
      "m20tokenartifacttall/w",
      "m20tokenartifacttall/u",
      "m20tokenartifacttall/b",
      "m20tokenartifacttall/r",
      "m20tokenartifacttall/g",
      "m20tokenartifacttall/m",
      // 5.1a's transform land pair: one master under every key, c only.
      "m15dfclandfront/w",
      "m15dfclandfront/u",
      "m15dfclandfront/b",
      "m15dfclandfront/r",
      "m15dfclandfront/g",
      "m15dfclandfront/m",
      "m15dfclandback/w",
      "m15dfclandback/u",
      "m15dfclandback/b",
      "m15dfclandback/r",
      "m15dfclandback/g",
      "m15dfclandback/m",
    ]);
    const m15Templates = FRAME_TEMPLATE_VALUES.filter(
      (t) => eraForTemplate(t) === "m15",
    );
    // + the borderless skins of 4.32 (their set, Borderless, is M15-era)
    // + 4.49 (b)'s two text-box tokens + 4.34's borderless land + 4.48 /
    // 4.50's six full-art tokens + 4.33's two borderless planeswalkers (every
    // colour referenced, the tall one's c by the serialized DFT #376) +
    // 4.52's emblem + 5.1a's five transform bodies.
    expect(m15Templates.length).toBe(34);
    expect(m15Templates).toContain("m15borderlessland");
    for (const template of m15Templates) {
      for (const colorKey of FRAME_COLOR_KEYS) {
        const key = frameComboKey(template, colorKey);
        const ref = FRAME_REFERENCES[template][colorKey];
        if (noRealPrinting.has(key)) {
          expect(ref, key).toBeNull();
        } else {
          expect(ref, key).not.toBeNull();
        }
      }
    }
  });

  it("all reference ids are UUIDs and thumb URLs shard correctly", () => {
    for (const template of FRAME_TEMPLATE_VALUES) {
      for (const colorKey of FRAME_COLOR_KEYS) {
        const ref = FRAME_REFERENCES[template][colorKey];
        if (!ref) continue;
        expect(ref.scryfallId).toMatch(UUID_RE);
        // A back body's reference (TODO 5.1a, face 1) is the printing's
        // BACK scan.
        const side = ref.face === 1 ? "back" : "front";
        expect(referenceThumbUrl(ref)).toBe(
          `https://cards.scryfall.io/normal/${side}/${ref.scryfallId[0]}/${ref.scryfallId[1]}/${ref.scryfallId}.jpg`,
        );
        expect(ref.face === 1, `${template}/${colorKey}`).toBe(getFrameProfile(template).dfc?.role === "back");
      }
    }
  });

  it("sample previews resolve to real frame profiles for every combo", () => {
    for (const template of FRAME_TEMPLATE_VALUES) {
      for (const colorKey of FRAME_COLOR_KEYS) {
        const sample = sampleFramePreview(template, colorKey);
        expect(sample.frameStyle.template).toBe(template);
        expect(getFrameProfile(template).label.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("frame availability", () => {
  it("verifying a combo publishes exactly that combo", () => {
    const verified = new Set([frameComboKey("saga", "w")]);
    expect(isFrameComboAvailable("saga", "w", verified)).toBe(true);
    expect(isFrameComboAvailable("saga", "u", verified)).toBe(false);
    expect(isFrameComboAvailable("adventure", "w", verified)).toBe(false);
    // No grandfathering: even the M15 standard is gated until verified.
    expect(isFrameComboAvailable("m15", "u", new Set())).toBe(false);
    expect(
      isFrameComboAvailable("m15", "u", new Set([frameComboKey("m15", "u")])),
    ).toBe(true);
  });
});

describe("sample previews for multi-panel frames", () => {
  it("carry a second face so the inline page/half is exercised", () => {
    for (const template of ["adventure", "flip", "split", "aftermath"] as const) {
      const sample = sampleFramePreview(template, "w") as { backFace?: { title?: string } | null };
      expect(sample.backFace?.title, template).toBeTruthy();
    }
    const plain = sampleFramePreview("m15", "w") as { backFace?: unknown };
    expect(plain.backFace).toBeNull();
  });

  it("render split/aftermath fronts as spells, not 3/3 creatures", () => {
    const split = sampleFramePreview("split", "u");
    expect(split.cardType).toBe("instant");
    expect(split.power).toBeNull();
    const aftermath = sampleFramePreview("aftermath", "b");
    expect(aftermath.cardType).toBe("sorcery");
    const flip = sampleFramePreview("flip", "r");
    expect(flip.cardType).toBe("creature");
    expect(flip.power).toBe("3");
  });
});
