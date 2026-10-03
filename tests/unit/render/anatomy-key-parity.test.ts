import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// TODO 4.6.0 — bake/preview KEY parity. The preview builds every frame, plate
// and overlay URL from the key as given (frameImageUrl, resolveColorAsset,
// frameOverlayImageUrl); the bake's loader used to map any key outside
// FRAME_MASTER_KEYS to "c" for masters AND plates. A pair master ("wu") would
// then bake as the Eldrazi colourless frame while the preview showed the
// pair, and a crown keyed "l" as the "c" band. For every profile × every key
// it can produce — its colour keys, its type-dressed masters, its pair
// masters, its plates and its overlays — the bake reads the file the preview
// shows. Run with the anatomy 4.6a / 4.6b will declare
// (tests/unit/cards/anatomy-fixture.ts), so the pair and overlay keys exist.
// ---------------------------------------------------------------------------

vi.mock("@/lib/cards/template-layout", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cards/template-layout")>();
  const { declaredGetFrameProfile } = await import("../cards/anatomy-fixture");
  return { ...real, getFrameProfile: declaredGetFrameProfile(real.getFrameProfile) };
});

import { frameAssetPath as previewFramePath } from "@/components/cards/frame-layer";
import {
  frameAssetPath as bakeFramePath,
  getFrameDataUrl,
  getFrameOverlayDataUrl,
  plateAssetPath as bakePlatePath,
} from "@/lib/render/card-frames";
import { FRAME_COLOR_KEYS, LEGENDARY_MASTER_KEYS, TWO_COLOR_MASTER_KEYS, legendaryMasterKey } from "@/lib/cards/frame-reference-registry";
import { getFrameProfile, resolveColorAsset } from "@/lib/cards/template-layout";
import { plateKeyFor, type TwoColorLook } from "@/lib/cards/anatomy";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

function masterKeysOf(template: string): string[] {
  const profile = getFrameProfile(template);
  const keys = new Set<string>(FRAME_COLOR_KEYS);
  for (const dressed of Object.values(profile.artifactMasterKeys ?? {})) if (dressed) keys.add(dressed);
  for (const dress of profile.twoColorMasters ?? []) {
    for (const key of TWO_COLOR_MASTER_KEYS) {
      if (dress === "hybrid" ? key.endsWith("-h") : !key.endsWith("-h")) keys.add(key);
    }
  }
  // The crowned twins (4.6f): every master the profile paints, `-legendary`.
  if (profile.crownMasters) for (const key of [...keys]) keys.add(legendaryMasterKey(key));
  return [...keys];
}

function plateKeysOf(template: string): string[] {
  const profile = getFrameProfile(template);
  const keys = new Set<string>();
  for (const colorKey of FRAME_COLOR_KEYS) {
    keys.add(plateKeyFor(colorKey, null));
    for (const dress of profile.twoColorMasters ?? []) {
      keys.add(plateKeyFor(colorKey, { pair: "wu", dress, masterKey: "wu" } as TwoColorLook));
    }
  }
  return [...keys];
}

describe("bake path = preview path", () => {
  it("every frame master a profile can paint, pair masters and crowned twins included", () => {
    let pairKeys = 0;
    let crownedKeys = 0;
    for (const template of FRAME_TEMPLATE_VALUES) {
      for (const key of masterKeysOf(template)) {
        expect(bakeFramePath(template, key), `${template}/${key}`).toBe(previewFramePath(template, key));
        if ((TWO_COLOR_MASTER_KEYS as readonly string[]).includes(key)) pairKeys += 1;
        if ((LEGENDARY_MASTER_KEYS as readonly string[]).includes(key)) crownedKeys += 1;
      }
    }
    // Not vacuous: m15's 20, m15artifact's and m15land's 10 each, the
    // borderless frames' 10 and 20 (4.6f, wave 2a), the snow frames' 10
    // each (wave 2c); the crowned twins of every borderless master (7 + 20
    // and 7 + 10).
    expect(pairKeys).toBe(90);
    expect(crownedKeys).toBe(44);
  });

  it("every stat plate a profile can paint (a hybrid pair's grey 'c' included)", () => {
    let plates = 0;
    for (const template of FRAME_TEMPLATE_VALUES) {
      const profile = getFrameProfile(template);
      for (const slot of [profile.pt, profile.loyalty, profile.defense]) {
        if (!slot?.plateAssetPathTemplate) continue;
        for (const key of plateKeysOf(template)) {
          expect(bakePlatePath(slot.plateAssetPathTemplate, key), `${template} ${key}`).toBe(
            resolveColorAsset(slot.plateAssetPathTemplate, key),
          );
          plates += 1;
        }
      }
    }
    expect(plates).toBeGreaterThan(100);
  });

  it("every overlay key a slot publishes resolves to its own path, and the bake's loader never swaps in another", () => {
    // The crown bands: m15crown (4.6a) and the extended-art band (4.6f).
    for (const template of FRAME_TEMPLATE_VALUES) {
      for (const slot of getFrameProfile(template).overlays ?? []) {
        const folder = template === "extendedart" ? "extendedcrown" : "m15crown";
        for (const key of slot.keys) {
          expect(slot.assetPathTemplate.replace("{key}", key)).toBe(`/frames/${folder}/${key}.png`);
        }
      }
    }
    // A master outside the list still reads as "c" (no stored card has one);
    // an overlay that isn't there is nothing — never the "c" band.
    const colourless = getFrameDataUrl("tarkirdragon", "c");
    expect(getFrameDataUrl("tarkirdragon", "zz")).toBe(colourless);
    expect(getFrameOverlayDataUrl("/frames/tarkirdragon/zz.png")).toBeNull();
    expect(getFrameOverlayDataUrl("/frames/tarkirdragon/w.png")).toBe(getFrameDataUrl("tarkirdragon", "w"));
  });
});
