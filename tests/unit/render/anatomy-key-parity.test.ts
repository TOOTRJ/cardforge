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

import { frameAssetPath as previewFramePath, frameOverlayImageUrl as previewOverlayUrl } from "@/components/cards/frame-layer";
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
    // each (wave 2c), the double-faced spell faces' 10 each but the modal
    // front's 20 (5.1d: 60), the borderless land's 10 (4.56); the crowned
    // twins of every borderless master (7 + 20 and 7 + 10).
    // …and the old frames' 10 each (4.6h: modern, modernland, retroland).
    // …and the Vehicle frame's 10 (4.5c), the Nyx dress's 20 (4.7).
    // …and the Universes Beyond frames' 20 + 10 + 10 (4.25).
    // …and the extended-art frame's 20 and its land dress's 10 (4.7 follow-up).
    // …and the Spacecraft's borderless dress's 7 crowned twins (4.27a step 2).
    // …and the full-art tokens' 10 each (4.48's central split: 60), and the
    // borderless double-faced bodies' 10 each (TODO 5.7: 40).
    // …and the Prepare frame's 20 (4.26: both dresses with the page).
    // …and the MKM dossier's 10 (4.11 wave 2: the pack's colour frames lerped).
    // …and the Doctor Who TARDIS's 10 (4.11 wave 2: its frames and braces lerped).
    expect(pairKeys).toBe(430);
    // …and the borderless double-faced bodies' 18 crowned twins each (TODO
    // 5.7: the seven colour keys, the artifact stand-in's `a`, ten pairs).
    expect(crownedKeys).toBe(51 + 4 * 18);
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
    // The crown bands: m15crown (4.6a), the extended-art band (4.6f) and the
    // Nyx dress's band (4.7: m15nyxcrown);
    // the transform icon riders (5.1a): dfcicon, keyed by the glyph; the
    // holofoil stamp's notch pieces (4.9c): m15holostamp on the M15
    // family, the walker's own m15pwholostamp.
    let riders = 0;
    let notches = 0;
    let strips = 0;
    for (const template of FRAME_TEMPLATE_VALUES) {
      for (const slot of getFrameProfile(template).overlays ?? []) {
        // The double-faced bodies' crowns (5.1d): the band cut round the
        // LEFT well (the transform front, the land front, the 2016–22 back),
        // the RIGHT well (the ▼ back) or the modal housing.
        const dfcCrown =
          template === "m15dfcback"
            ? "m15dfccrownright"
            : template.startsWith("m15mdfc")
              ? "m15mdfccrown"
              : template.startsWith("m15dfc")
                ? "m15dfccrown"
                : null;
        // The Universes Beyond frames (4.25): their own crown band and
        // triangle notch.
        const ub = template === "m15ub" || template === "m15ubartifact" || template === "m15ubland";
        // The modal strip riders (5.1c): each modal template's own strip
        // folder, <template>/strip/<key>.
        const folder =
          slot.anatomy === "dfcIcon"
            ? "dfcicon"
            : slot.anatomy === "partPage"
              ? // The Prepare spell's page in its own colour (4.26).
                `${template}/page`
            : slot.anatomy === "mdfcStrip"
              ? `${template}/strip`
            : slot.anatomy === "holoStamp"
              ? // The Zendikar Rising hedron showcase (4.11): the notch split
                // off its own masters, beside them.
                template === "fullart"
                ? "fullart/holostamp"
                : template === "m15pw"
                ? "m15pwholostamp"
                : ub
                  ? "m15ubholostamp"
                  : // The borderless frames (4.9d): their own lifted arch,
                    // the land's and the station's over their own masters.
                    template === "m15borderless" || template === "m15borderlessartifact"
                    ? "m15borderlessholostamp"
                    : template === "m15borderlesspw" || template === "m15borderlesspwtall"
                      ? "m15borderlesspwholostamp"
                    : template === "m15borderlessland"
                      ? "m15borderlesslandholostamp"
                      : template === "m15borderlessstation"
                        ? "m15borderlessstationholostamp"
                        : template === "lotrscroll"
                          ? // The Lord of the Rings scroll's own piece per key (4.11).
                            "lotrscrollholostamp"
                          : template === "lotr"
                            ? // …and the ring's.
                              "lotrholostamp"
                            : template === "tarkirdragon"
                              ? // …and the MUL Tarkir dragon wings' oval piece.
                                "tarkirdragonholostamp"
                              : template === "tarkirdraconic"
                                ? // …and the Tarkir draconic's own MSE stamp (4.11).
                                  "tarkirdraconicholostamp"
                                : template === "bloomburrow"
                                  ? // …and the Bloomburrow woodland's (4.11, v69).
                                    "bloomburrowholostamp"
                                  : template === "bloomanime"
                                    ? // …and the Bloomburrow anime's (4.11, v70).
                                      "bloomanimeholostamp"
                                    : template === "dndsourcebook"
                                      ? // …and the D&D Sourcebook's oval piece (4.11 wave 2).
                                        "dndsourcebookholostamp"
                                    : template === "dossier"
                                      ? // …and the MKM dossier's oval piece (4.11 wave 2).
                                        "dossierholostamp"
                                    : template === "enchantingtales"
                                      ? // …and the Enchanting Tales' (4.11 wave 2).
                                        "enchantingtalesholostamp"
                                    : template === "tardis"
                                      ? // …and the Doctor Who TARDIS's trapezoid (4.11 wave 2).
                                        "tardisholostamp"
                                      : "m15holostamp"
              : template === "fullart"
                ? // The Zendikar Rising hedron showcase's crown band (4.11).
                  "fullartcrown"
                : template === "extendedart" || template === "extendedartland" || template === "extendedartstation"
                ? "extendedcrown"
                : ub
                  ? "m15ubcrown"
                : template === "m15nyx"
                  ? // The Nyx dress's crown (4.7): the band with the starfield strip.
                    "m15nyxcrown"
                  : template === "nyx"
                    ? // The Nyx Constellation frame's crown: that band, its arms faded.
                      "nyxcrown"
                    : template.startsWith("m20token")
                      ? // The full-art token's floating crown band (4.48).
                        "m20tokencrown"
                      : template === "lotrscroll"
                        ? // The Lord of the Rings scroll's own crown band (4.11).
                          "lotrscrollcrown"
                        : template === "lotr"
                          ? // …and the ring's.
                            "lotrcrown"
                          : template === "tarkirdragon"
                            ? // …and the MUL Tarkir dragon wings' spikes.
                              "tarkirdragoncrown"
                            : template === "bloomburrow"
                              ? // …and the Bloomburrow woodland's leaves (4.11, v69).
                                "bloomburrowcrown"
                              : template === "bloomanime"
                                ? // …and the Bloomburrow anime's flourish (4.11, v70).
                                  "bloomanimecrown"
                                : template === "dossier"
                                  ? // …and the MKM dossier's torn strip (4.11 wave 2).
                                    "dossiercrown"
                                  : (dfcCrown ?? "m15crown");
        for (const key of slot.keys) {
          expect(slot.assetPathTemplate.replace("{key}", key), `${template} ${slot.anatomy}`).toBe(`/frames/${folder}/${key}.png`);
          if (slot.anatomy === "holoStamp") notches += 1;
          if (slot.anatomy === "dfcIcon") {
            // The preview's frameOverlayImageUrl and the bake's loader read
            // the same manifest key (the bake's data URL is null here: no
            // bucket in a unit test — never a stand-in).
            expect(previewOverlayUrl(slot.assetPathTemplate.replace("{key}", key))).toContain(`dfcicon/${key}.`);
            riders += 1;
          }
          if (slot.anatomy === "mdfcStrip") {
            expect(previewOverlayUrl(slot.assetPathTemplate.replace("{key}", key))).toContain(`${template}/strip/${key}.`);
            strips += 1;
          }
        }
        // A keyMap only ever points at a key the slot publishes.
        for (const to of Object.values(slot.keyMap ?? {})) expect(slot.keys, `${template} ${slot.anatomy} keyMap → ${to}`).toContain(to);
      }
    }
    // The four rider slots × 12 glyphs (m15dfcfront, m15dfclandfront,
    // m15dfcbackleft, and the borderless front's, TODO 5.7) — and the double-
    // faced saga front's (5.5 (b)): five.
    expect(riders).toBe(60);
    // The four modal strip slots (5.1c): 8 keys on each spell body (w u b r
    // g m a + l), 7 on each land body (w u b r g m c).
    // …and the borderless modal pair's 7 each (TODO 5.7: no `l`).
    expect(strips).toBe(8 + 8 + 7 + 7 + 7 + 7);
    // Not vacuous: 9 bar keys + the 10 pairs (the 4.9c follow-up) × the eight
    // M15-family entries (the Vehicle frame's since 4.5c, the Nyx dress's since 4.7) + the walker's 7 — and none on a DFC body, the
    // transform (5.1a) and modal (5.1b) bodies alike (no holoStamp on a back
    // body, ever; the fronts take it as their own addition later).
    // …and the station frame's two entries (TODO 4.27a): the parents' notch
    // slot, so — with the Nyx dress (TODO 4.7) — ten M15-family entries;
    // …and the Universes Beyond triangle's 9 bar keys + 10 pairs on its
    // three entries (4.25); and the Spacecraft's extended-art dress's (4.27a
    // step 2: M15's bottom border) — eleven.
    // …and the borderless family's own pieces (4.9d): 8 bar keys + 10
    // pairs on m15borderless and its artifact dress, the land's 7 + 10, the
    // station's 7; and the borderless walkers' 7 on each of their two
    // entries (owner Round 70).
    // …and the Lord of the Rings scroll's 8 keys (4.11, the pack's own pieces),
    // the Zendikar Rising hedron showcase's 7 (4.11), the LOTR ring's 8 and
    // the MUL Tarkir dragon wings' 7, and the Tarkir draconic's 7 (4.11,
    // MSE's own stamp per key; `c` the steel rim), and the Bloomburrow
    // woodland's 7 (4.11, v69), the Bloomburrow anime's 7 (4.11, v70), and
    // the D&D Sourcebook's 7 (4.11 wave 2, the pack's one oval piece under
    // every key), and the MKM dossier's 7 + 10 pairs (4.11 wave 2, the
    // pack's one oval piece under every key and pair), and the Enchanting
    // Tales' 7 (4.11 wave 2, the pack's piece per colour), and the Doctor
    // Who TARDIS's 7 + 10 pairs (4.11 wave 2, the pack's one trapezoid under
    // every key and pair).
    expect(notches).toBe((9 + 10) * 11 + 7 + (9 + 10) * 3 + (8 + 10) * 2 + (7 + 10) + 7 + 7 * 2 + 8 + 7 + 8 + 7 + 7 + 7 + 7 + 7 + (7 + 10) + 7 + (7 + 10));
    for (const template of [
      "m15dfcfront", "m15dfcback", "m15dfcbackleft", "m15dfclandfront", "m15dfclandback",
      "m15mdfcfront", "m15mdfcback", "m15mdfclandfront", "m15mdfclandback",
    ] as const) {
      expect((getFrameProfile(template).overlays ?? []).some((slot) => slot.anatomy === "holoStamp"), template).toBe(false);
    }
    // A master outside the list still reads as "c" (no stored card has one;
    // a git master: tarkirdraconic — tarkirdragon left git with TODO 4.11);
    // an overlay that isn't there is nothing — never the "c" band.
    const colourless = getFrameDataUrl("tarkirdraconic", "c");
    expect(getFrameDataUrl("tarkirdraconic", "zz")).toBe(colourless);
    expect(getFrameOverlayDataUrl("/frames/tarkirdraconic/zz.png")).toBeNull();
    expect(getFrameOverlayDataUrl("/frames/tarkirdraconic/w.png")).toBe(getFrameDataUrl("tarkirdraconic", "w"));
  });
});
