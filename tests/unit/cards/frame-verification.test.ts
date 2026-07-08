import { describe, expect, it } from "vitest";

import {
  FRAME_COLOR_KEYS,
  FRAME_REFERENCES,
  frameComboKey,
  referenceThumbUrl,
  sampleFramePreview,
} from "@/lib/cards/frame-reference-registry";
import {
  GRANDFATHERED_TEMPLATES,
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
    const noRealPrinting = new Set([
      "m15token/m",
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
      // Printed artifact tokens are all colorless — no colored anchors.
      "m15tokenartifact/w",
      "m15tokenartifact/u",
      "m15tokenartifact/b",
      "m15tokenartifact/r",
      "m15tokenartifact/g",
      "m15tokenartifact/m",
    ]);
    const m15Templates = FRAME_TEMPLATE_VALUES.filter(
      (t) => eraForTemplate(t) === "m15",
    );
    expect(m15Templates.length).toBe(15);
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
        expect(referenceThumbUrl(ref)).toBe(
          `https://cards.scryfall.io/normal/front/${ref.scryfallId[0]}/${ref.scryfallId[1]}/${ref.scryfallId}.jpg`,
        );
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
  it("grandfathers only templates users could already pick", () => {
    // Verification is the ONLY gate (owner decision) — nothing is
    // grandfathered anymore; every template publishes per (template, color)
    // through /admin/frame-compare.
    expect(GRANDFATHERED_TEMPLATES.size).toBe(0);
    for (const gated of [
      "m15",
      "m15pw",
      "battle",
      "retro",
      "saga",
      "lotr",
    ] as const) {
      expect(GRANDFATHERED_TEMPLATES.has(gated), gated).toBe(false);
    }
  });

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
