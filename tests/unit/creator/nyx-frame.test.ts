import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import printingsData from "../cards/fixtures/reference-printings.json";
import referencesData from "@/lib/cards/frame-references.json";
import { frameAnatomyOf } from "@/lib/cards/anatomy";
import { frameGateError } from "@/lib/cards/frame-availability";
import { cardFieldsFace, frameKindGateError, frameKindUpdateGateError } from "@/lib/cards/frame-kind-gate";
import { frameComboKey, FRAME_COLOR_KEYS } from "@/lib/cards/frame-reference-registry";
import { validateReferenceForCombo } from "@/lib/cards/frame-reference-validation";
import { M15_FAMILY_TEMPLATES } from "@/lib/cards/m15-family";
import { PLATE_INK } from "@/lib/cards/plate-ink";
import { frontDrawsPowerToughness } from "@/lib/cards/pt-drawn";
import { M15_CROWN, M15_HOLO_STAMP, M15_NYX_CROWN, getFrameProfile } from "@/lib/cards/template-layout";
import { remixCreditsOf, scryfallRemixMechanics } from "@/lib/ai/remix-mechanics";
import {
  CARD_KIND_VALUES,
  baseFrameFor,
  borrowedTypeWord,
  enchantmentDressReason,
  enchantmentFrameFits,
  enchantmentFrameFor,
  followsEnchantmentDress,
  framesForKind,
  isBorrowedVariation,
  isEnchantmentDress,
  skinVariantsFor,
  templateRefusesKind,
  templateSupportsKind,
  type CardKind,
} from "@/lib/creator/card-kinds";
import { walkthroughKindFor } from "@/lib/creator/frame-preview";
import { resolveGeneratedFrame } from "@/lib/creator/frame-random";
import { finalizeImportMatch, resolveImportFrame, resolvePublishedFrame, withVerification } from "@/lib/creator/frame-resolve";
import { frameFitsImport, importFramePlan } from "@/lib/creator/import-frame-choice";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import { FRAME_SIGNATURE_KEYS, signatureDrawnOn } from "@/lib/scryfall/frame-signatures";
import { frameMatchFromScryfall, mapScryfallToFormPatch, type ScryfallImportPatch } from "@/lib/scryfall/import-mapper";
import { FRAME_TEMPLATE_LABELS, FRAME_TEMPLATE_SET, FRAME_TEMPLATE_VALUES, TEMPLATE_SKIN_VARIANTS, type FrameTemplate } from "@/types/card";
import { CC_OVERLAY_BANDS, CC_TEMPLATES, NYX, NYX_CROWN_BAND_KEYS, NYX_INNER_CROWN, builtColors, innerCrownRecipe } from "@/scripts/lib/cc-frames.mjs";
import { TWO_COLOR_PAIRS } from "@/scripts/lib/pair-ramp.mjs";

// ---------------------------------------------------------------------------
// TODO 4.7 — the Nyx dress (`m15nyx`): the printed ENCHANTMENT frame, a stored
// template of its own (owner decisions A3 / A4, 2026-09-29; the frame roadmap
// of 2026-10-13, block 3) for the cards whose type words say Enchantment. A
// new Enchantment Creature or Enchantment Artifact starts on it once it is
// verified in the card's colour, a plain enchantment is offered it, stored
// cards keep their frame, imports follow the printing. NOT the token kind's
// Nyx (4.51), nor the `nyx` template (the THB constellation showcase).
// ---------------------------------------------------------------------------

const printings = printingsData as Record<string, unknown>;
const keys = (...pairs: Array<[string, string]>) => new Set(pairs.map(([t, c]) => frameComboKey(t as never, c)));
const EVERY = new Set(FRAME_TEMPLATE_VALUES.flatMap((t) => FRAME_COLOR_KEYS.map((k) => frameComboKey(t, k))));
const byName = (name: string, number?: string) => {
  const found = Object.values(printings).find(
    (p) => (p as { name: string }).name === name && (!number || (p as { collector_number: string }).collector_number === number),
  );
  if (!found) throw new Error(`no captured printing named ${name}`);
  return scryfallCardSchema.parse(found);
};

/** Production's verified combos (supabase/seed.sql mirrors them). */
function productionVerifiedKeys(): Set<string> {
  const sql = readFileSync(join(process.cwd(), "supabase/seed.sql"), "utf8");
  const block = /-- frame_reviews:begin\n([\s\S]*?)-- frame_reviews:end/.exec(sql)?.[1].replace(/--.*$/gm, "");
  if (!block) throw new Error("frame_reviews block missing from seed.sql");
  const everyColour = /unnest\(array\[([^\]]*)\]\)\s+as t/.exec(block)?.[1] ?? "";
  const out = new Set<string>();
  for (const [, template] of everyColour.matchAll(/'([^']+)'/g)) {
    for (const colour of FRAME_COLOR_KEYS) out.add(frameComboKey(template as FrameTemplate, colour));
  }
  for (const [, template, colour] of block.matchAll(/\('([^']+)',\s*'([wubrgcm])',\s*true/g)) {
    out.add(frameComboKey(template as FrameTemplate, colour));
  }
  return out;
}
const PROD = productionVerifiedKeys();
const withNyx = (...colours: string[]) => new Set([...PROD, ...colours.map((c) => frameComboKey("m15nyx", c))]);
const NYX_VERIFIED = withNyx(...FRAME_COLOR_KEYS);

const ENVOY = byName("Transcendent Envoy"); // THB #40: Enchantment Creature, white, 1/2
const BLESSING = byName("Twinblade Blessing"); // FDN #26: Enchantment — Aura, white
const DAXOS = byName("Daxos, Blessed by the Sun", "9"); // THB #9: legendary
const KLOTHYS = byName("Klothys, God of Destiny", "220"); // THB #220: legendary, red-green
const RESCUE = byName("Eagle's Rescue"); // HOB #155: hybrid white-blue Aura
const BIDENT = byName("Bident of Thassa"); // LCC #146: Legendary Enchantment Artifact, blue
const CONSCRIPTION = byName("Eldrazi Conscription"); // SOC #131: colourless

describe("the profile", () => {
  const nyx = getFrameProfile("m15nyx");
  const m15 = getFrameProfile("m15");

  it("is m15's slots and sizes with its own masters, plates and crown — and no art under the frame", () => {
    const { pt: nyxPt, label: nyxLabel, overlays: nyxOverlays, ...restNyx } = nyx;
    const { pt: m15Pt, label: m15Label, overlays: m15Overlays, underFrameArt, ...restM15 } = m15;
    expect(restNyx).toEqual(restM15);
    expect(nyxLabel).toBe("M15 Nyx");
    expect(m15Label).toBe("M15");
    expect(nyxPt).toEqual({ ...m15Pt, plateAssetPathTemplate: "/frames/m15nyx/pt/{color}.png" });
    // m15's colourless master is the see-through Eldrazi frame; the Nyx
    // dress's is the opaque silver starfield.
    expect(underFrameArt).toBeDefined();
    expect(nyx.underFrameArt).toBeUndefined();
    expect(m15Overlays).toEqual([M15_CROWN, M15_HOLO_STAMP]);
    expect(nyxOverlays).toEqual([
      { ...M15_NYX_CROWN, keyMap: { c: "a" } },
      { ...M15_HOLO_STAMP, keyMap: { c: "a" } },
    ]);
  });

  it("draws the Nyx crown at the M15 crown's rect, from its own folder, for its own keys", () => {
    expect(M15_NYX_CROWN.rect).toEqual(M15_CROWN.rect);
    expect(M15_NYX_CROWN.anatomy).toBe("crown");
    expect(M15_NYX_CROWN.assetPathTemplate).toBe("/frames/m15nyxcrown/{key}.png");
    expect([...M15_NYX_CROWN.keys]).toEqual(NYX_CROWN_BAND_KEYS);
    expect([...M15_NYX_CROWN.keys]).toEqual(["w", "u", "b", "r", "g", "m", "a", ...TWO_COLOR_PAIRS]);
    // Only this frame reads the band.
    expect(
      FRAME_TEMPLATE_VALUES.filter((t) => (getFrameProfile(t).overlays ?? []).some((o) => o.assetPathTemplate === M15_NYX_CROWN.assetPathTemplate)),
    ).toEqual(["m15nyx"]);
  });

  it("declares every piece m15 declares: the crown, both two-colour dresses, the collector line, the stamp, the text alignment", () => {
    expect(frameAnatomyOf("m15nyx")).toEqual(frameAnatomyOf("m15"));
    expect(nyx.twoColorMasters).toEqual(["split", "hybrid"]);
    expect(nyx.collector).toEqual(m15.collector);
    expect(M15_FAMILY_TEMPLATES).toContain("m15nyx");
    expect(FRAME_TEMPLATE_SET.m15nyx).toBe("m15");
    expect(FRAME_TEMPLATE_LABELS.m15nyx).toBe("Nyx");
  });

  it("has a measured keep-out for its plate — m15's, the same images — and draws a P/T", () => {
    expect(PLATE_INK["/frames/m15nyx/pt/{color}.png"]).toEqual(PLATE_INK["/frames/m15/pt/{color}.png"]);
    expect(frontDrawsPowerToughness("m15nyx")).toBe(true);
  });
});

describe("the importer's recipe", () => {
  it("builds the seven colour keys from Card Conjurer's Nyx masters whole — the colourless key from the pack's artifact starfield", () => {
    const def = CC_TEMPLATES.m15nyx;
    expect(builtColors(def)).toEqual(builtColors(CC_TEMPLATES.m15));
    for (const k of ["w", "u", "b", "r", "g", "m"]) expect(def.colors[k], k).toEqual([{ src: `${NYX}/${k}.png` }]);
    expect(def.colors.c).toEqual([{ src: `${NYX}/a.png` }]);
    expect(NYX).toBe("img/frames/m15/new/nyx");
  });

  it("builds m15's two pair dresses over the starfield: the gold master whole, the hybrid's two starfields under the regular grey bars", () => {
    const def = CC_TEMPLATES.m15nyx;
    const srcs = (key: string) => JSON.stringify(def.colors[key]);
    for (const pair of TWO_COLOR_PAIRS) {
      const [a, b] = pair.split("");
      expect(def.colors[pair][0], pair).toEqual({ src: `${NYX}/m.png` });
      expect(srcs(pair), pair).toContain(`${NYX}/${a}.png`);
      expect(srcs(pair), pair).toContain(`${NYX}/${b}.png`);
      expect(def.colors[`${pair}-h`][0], pair).toMatchObject({ src: `${NYX}/${a}.png`, right: `${NYX}/${b}.png` });
      // The hybrid's grey bars are the regular pack's land frame: the Nyx
      // pack has no land file, and its bars are the regular masters' own.
      expect(srcs(`${pair}-h`), pair).toContain("img/frames/m15/new/l.png");
      expect(srcs(`${pair}-h`), pair).not.toContain(`${NYX}/l.png`);
    }
  });

  it("draws M15's own plates", () => {
    expect(CC_TEMPLATES.m15nyx.plates).toEqual(CC_TEMPLATES.m15.plates);
  });

  it("the crown band is the m15crown recipe with the Nyx inner crown on top, 1:1 at the pack's bounds", () => {
    const band = CC_OVERLAY_BANDS.m15nyxcrown;
    expect(band.band).toBe(CC_OVERLAY_BANDS.m15crown.band);
    expect(band.keys).toEqual(NYX_CROWN_BAND_KEYS);
    expect(band.inner).toBe(NYX_INNER_CROWN);
    // packM15InnerCrownsNew.js: 329/2010, 70/2814, 1353 × 64.
    expect(NYX_INNER_CROWN.box).toEqual({ x: 329, y: 70, width: 1353, height: 64 });
    expect(innerCrownRecipe(NYX_INNER_CROWN, "w")).toEqual({ left: "img/frames/m15/innerCrowns/new/nyx/w.png", right: null, ramp: null });
    expect(innerCrownRecipe(NYX_INNER_CROWN, "rg")).toMatchObject({
      left: "img/frames/m15/innerCrowns/new/nyx/r.png",
      right: "img/frames/m15/innerCrowns/new/nyx/g.png",
    });
    expect(() => innerCrownRecipe(NYX_INNER_CROWN, "l")).toThrow();
  });

  it("is published: every master, plate and crown band is in the manifest, and no Card Conjurer pixel in git", () => {
    const { files } = JSON.parse(readFileSync("lib/frames/frame-manifest.json", "utf8")) as { files: Record<string, { width: number; height: number }> };
    for (const key of builtColors(CC_TEMPLATES.m15nyx)) {
      expect([files[`m15nyx/${key}.png`]?.width, files[`m15nyx/${key}.png`]?.height], key).toEqual([1500, 2100]);
      expect(files[`m15nyx/${key}.webp`], key).toBeDefined();
    }
    for (const key of FRAME_COLOR_KEYS) expect(files[`m15nyx/pt/${key}.png`], key).toBeDefined();
    for (const key of NYX_CROWN_BAND_KEYS) {
      expect([files[`m15nyxcrown/${key}.png`]?.width, files[`m15nyxcrown/${key}.png`]?.height], key).toEqual([1500, 410]);
    }
    expect(Object.keys(files).filter((k) => k.startsWith("m15nyx/")).length).toBe((27 + 7) * 2);
    expect(Object.keys(files).filter((k) => k.startsWith("m15nyxcrown/")).length).toBe(17 * 2);
  });
});

describe("the enchantment dress", () => {
  const creature = { cardType: "creature", supertype: "Enchantment" };
  const legend = { cardType: "creature", supertype: "Legendary Enchantment" };
  const plainCreature = { cardType: "creature", supertype: "" };
  const aura = { cardType: "enchantment", supertype: "" };
  const weapon = { cardType: "enchantment", supertype: "Legendary Artifact" };
  const typedArtifact = { cardType: "artifact", supertype: "Enchantment" };
  const ring = { cardType: "artifact", supertype: "" };

  it("names the Nyx frame alone", () => {
    expect(FRAME_TEMPLATE_VALUES.filter(isEnchantmentDress)).toEqual(["m15nyx"]);
    expect(enchantmentDressReason("m15nyx")).toBe("The Nyx frame is for enchantments");
    expect(enchantmentDressReason("m15")).toBeNull();
  });

  it("fits any card whose type words say Enchantment — the card type or a supertype word, whatever its case — and no other", () => {
    for (const type of [creature, legend, aura, weapon, typedArtifact, { cardType: "creature", supertype: "enchantment" }]) {
      expect(enchantmentFrameFits("m15nyx", type), JSON.stringify(type)).toBe(true);
    }
    for (const type of [plainCreature, ring, { cardType: "instant", supertype: "" }, { cardType: "creature", supertype: "Enchantmentish" }, { cardType: null, supertype: null }]) {
      expect(enchantmentFrameFits("m15nyx", type), JSON.stringify(type)).toBe(false);
    }
    for (const t of FRAME_TEMPLATE_VALUES) if (t !== "m15nyx") expect(enchantmentFrameFits(t, plainCreature), t).toBe(true);
  });

  it("is followed by an Enchantment Creature and an Enchantment Artifact — never a plain enchantment or an Aura", () => {
    expect(followsEnchantmentDress(creature)).toBe(true);
    expect(followsEnchantmentDress(legend)).toBe(true);
    expect(followsEnchantmentDress(weapon)).toBe(true);
    expect(followsEnchantmentDress(typedArtifact)).toBe(true);
    expect(followsEnchantmentDress(aura)).toBe(false);
    expect(followsEnchantmentDress({ cardType: "enchantment", supertype: "Legendary" })).toBe(false);
    expect(followsEnchantmentDress(plainCreature)).toBe(false);
    expect(followsEnchantmentDress(ring)).toBe(false);
  });

  it("the words move a card between its kind's M15 frame and the dress, and no other frame", () => {
    // Onto the dress: the kind's base, the words saying Enchantment + Creature or Artifact.
    expect(enchantmentFrameFor("creature", "m15", creature)).toBe("m15nyx");
    expect(enchantmentFrameFor("enchantment", "m15", weapon)).toBe("m15nyx");
    expect(enchantmentFrameFor("artifact", "m15artifact", typedArtifact)).toBe("m15nyx");
    // Not a plain enchantment, not a plain creature, not an artifact.
    expect(enchantmentFrameFor("enchantment", "m15", aura)).toBe("m15");
    expect(enchantmentFrameFor("creature", "m15", plainCreature)).toBe("m15");
    expect(enchantmentFrameFor("artifact", "m15artifact", ring)).toBe("m15artifact");
    // Back: only when the words stop saying Enchantment — to the kind's own base.
    expect(enchantmentFrameFor("creature", "m15nyx", plainCreature)).toBe("m15");
    expect(enchantmentFrameFor("artifact", "m15nyx", ring)).toBe("m15artifact");
    expect(enchantmentFrameFor("creature", "m15nyx", creature)).toBe("m15nyx");
    // A plain enchantment that wears it keeps it (its maker's pick).
    expect(enchantmentFrameFor("enchantment", "m15nyx", aura)).toBe("m15nyx");
    // A kind the dress doesn't dress, and every other frame, as they are.
    expect(enchantmentFrameFor("instant", "m15", { cardType: "instant", supertype: "Enchantment" })).toBe("m15");
    expect(enchantmentFrameFor("creature", "m15artifact", { cardType: "creature", supertype: "Enchantment Artifact" })).toBe("m15artifact");
    for (const t of FRAME_TEMPLATE_VALUES) {
      if (t === "m15" || t === "m15nyx") continue;
      expect(enchantmentFrameFor("creature", t, creature), t).toBe(t);
    }
  });

  it("dresses the three kinds an enchantment can be, and no other", () => {
    expect(CARD_KIND_VALUES.filter((kind) => !templateRefusesKind("m15nyx", kind))).toEqual(["creature", "artifact", "enchantment"]);
    expect(CARD_KIND_VALUES.filter((kind) => templateSupportsKind("m15nyx", kind))).toEqual(["creature", "artifact", "enchantment"]);
    for (const kind of ["instant", "sorcery", "land", "planeswalker", "token", "saga"] as CardKind[]) {
      expect(framesForKind(kind, EVERY).map((f) => f.template), kind).not.toContain("m15nyx");
    }
  });

  it("a creature and an artifact BORROW it as Enchantment (A3 / A4: picking it writes the word); the Enchantment kind wears it as its own skin", () => {
    expect(isBorrowedVariation("creature", "m15nyx")).toBe(true);
    expect(borrowedTypeWord("creature", "m15nyx")).toBe("Enchantment");
    expect(isBorrowedVariation("artifact", "m15nyx")).toBe(true);
    expect(borrowedTypeWord("artifact", "m15nyx")).toBe("Enchantment");
    expect(isBorrowedVariation("enchantment", "m15nyx")).toBe(false);
    expect(borrowedTypeWord("enchantment", "m15nyx")).toBeNull();
    // Under each kind's own M15 standard, in the Variations section.
    expect(skinVariantsFor("creature", "m15")).toContain("m15nyx");
    expect(skinVariantsFor("enchantment", "m15")).toContain("m15nyx");
    expect(skinVariantsFor("artifact", "m15artifact")).toContain("m15nyx");
    expect(skinVariantsFor("instant", "m15")).not.toContain("m15nyx");
    expect(skinVariantsFor("sorcery", "m15")).not.toContain("m15nyx");
    expect(TEMPLATE_SKIN_VARIANTS.m15).not.toContain("m15nyx");
    expect(baseFrameFor("creature", "m15nyx")).toBe("m15");
    expect(baseFrameFor("enchantment", "m15nyx")).toBe("m15");
    expect(baseFrameFor("artifact", "m15nyx")).toBe("m15artifact");
    // The admin walk-through walks it as an enchantment (its own kind).
    expect(walkthroughKindFor("m15nyx")).toBe("enchantment");
  });

  it("is never a stand-in for another frame", () => {
    // An unverified frame's fallback never lands a card on the Nyx dress.
    const onlyNyx = keys(["m15nyx", "w"]);
    const resolution = resolvePublishedFrame({ kind: "enchantment", candidates: ["m15"], colorKey: "w", verifiedKeys: onlyNyx, prefer: "colour" });
    expect(resolution.status === "unavailable" || resolution.template !== "m15nyx").toBe(true);
  });
});

describe("the server's gate", () => {
  const creature = { cardType: "creature", supertype: "Enchantment", subtypes: ["Griffin"], title: "Transcendent Envoy" };
  const elves = { cardType: "creature", supertype: "", subtypes: ["Elf", "Druid"], title: "Llanowar Elves" };
  const aura = { cardType: "enchantment", supertype: "", subtypes: ["Aura"], title: "Pacifism" };
  const weapon = { cardType: "enchantment", supertype: "Legendary Artifact", subtypes: [], title: "Bident of Thassa" };
  const ring = { cardType: "artifact", supertype: "", subtypes: [], title: "Sol Ring" };
  const REFUSED = "The Nyx frame is for enchantments — pick another frame.";

  it("takes an enchantment on the Nyx frame — a creature, an artifact, a plain one — and refuses anything else there", () => {
    expect(frameKindGateError("m15nyx", creature)).toBeNull();
    expect(frameKindGateError("m15nyx", aura)).toBeNull();
    expect(frameKindGateError("m15nyx", weapon)).toBeNull();
    expect(frameKindGateError("m15nyx", { ...ring, supertype: "Enchantment" })).toBeNull();
    expect(frameKindGateError("m15nyx", elves)).toBe(REFUSED);
    expect(frameKindGateError("m15nyx", ring)).toBe(REFUSED);
    expect(frameKindGateError("m15nyx", { cardType: "instant", supertype: "", subtypes: [], title: "x" })).toMatch(/doesn't dress Instant cards/);
    expect(frameKindGateError("m15nyx", { cardType: "land", supertype: "Enchantment", subtypes: [], title: "x" })).toMatch(/doesn't dress Land cards/);
    // Every other frame is as it was: an enchantment may still wear any of them.
    for (const t of ["m15", "m15snow", "modern", "nyx"] as const) expect(frameKindGateError(t, creature), t).toBeNull();
    expect(frameKindGateError("m15", elves)).toBeNull();
  });

  it("refuses an edit that takes the Enchantment word off a card on the frame, or moves a non-enchantment onto it", () => {
    expect(frameKindUpdateGateError({ existingTemplate: "m15nyx", nextTemplate: undefined, existing: creature, next: elves })).toBe(REFUSED);
    expect(frameKindUpdateGateError({ existingTemplate: "m15", nextTemplate: "m15nyx", existing: elves, next: elves })).toBe(REFUSED);
    expect(frameKindUpdateGateError({ existingTemplate: "m15", nextTemplate: "m15nyx", existing: creature, next: creature })).toBeNull();
    // A stored enchantment on another frame is never touched by the gate.
    expect(frameKindUpdateGateError({ existingTemplate: "m15", nextTemplate: undefined, existing: creature, next: creature })).toBeNull();
  });
});

describe("AI and random frames (resolveGeneratedFrame)", () => {
  const face = { cardType: "creature", supertype: "Enchantment", subtypes: ["Spirit"], title: "Eidolon", power: "2", toughness: "2" };
  const both = keys(["m15", "w"], ["m15nyx", "w"]);

  it("lands a new Enchantment Creature on the Nyx frame where it is published in the card's colour, on its plain frame where it isn't", () => {
    expect(resolveGeneratedFrame({ cardType: "creature", requested: "m15", colorIdentity: ["white"], verifiedKeys: both, face })).toBe("m15nyx");
    for (const roll of [0, 0.3, 0.6, 0.99]) {
      expect(
        resolveGeneratedFrame({ cardType: "creature", requested: "random", colorIdentity: ["white"], verifiedKeys: both, face, random: () => roll }),
      ).toBe("m15nyx");
    }
    const plainOnly = keys(["m15", "w"]);
    expect(resolveGeneratedFrame({ cardType: "creature", requested: "m15", colorIdentity: ["white"], verifiedKeys: plainOnly, face })).toBe("m15");
    expect(resolveGeneratedFrame({ cardType: "creature", requested: "random", colorIdentity: ["white"], verifiedKeys: plainOnly, face })).toBe("m15");
    // Another colour's tick never counts.
    expect(
      resolveGeneratedFrame({ cardType: "creature", requested: "m15", colorIdentity: ["white"], verifiedKeys: keys(["m15", "w"], ["m15nyx", "u"]), face }),
    ).toBe("m15");
  });

  it("an Enchantment Artifact follows it too, in either card type", () => {
    const verified = keys(["m15", "u"], ["m15artifact", "u"], ["m15nyx", "u"]);
    expect(
      resolveGeneratedFrame({
        cardType: "enchantment", requested: "m15", colorIdentity: ["blue"], verifiedKeys: verified,
        face: { cardType: "enchantment", supertype: "Legendary Artifact", subtypes: [], title: "Bident" },
      }),
    ).toBe("m15nyx");
    expect(
      resolveGeneratedFrame({
        cardType: "artifact", requested: "m15artifact", colorIdentity: ["blue"], verifiedKeys: verified,
        face: { cardType: "artifact", supertype: "Enchantment", subtypes: [], title: "Bident" },
      }),
    ).toBe("m15nyx");
  });

  it("never moves a plain enchantment there by itself — and gives it the frame when it is asked for by name", () => {
    const aura = { cardType: "enchantment", supertype: "", subtypes: ["Aura"], title: "Pacifism" };
    expect(resolveGeneratedFrame({ cardType: "enchantment", requested: "m15", colorIdentity: ["white"], verifiedKeys: both, face: aura })).toBe("m15");
    for (const roll of [0, 0.5, 0.99]) {
      expect(
        resolveGeneratedFrame({ cardType: "enchantment", requested: "random", colorIdentity: ["white"], verifiedKeys: both, face: aura, random: () => roll }),
      ).toBe("m15");
    }
    expect(resolveGeneratedFrame({ cardType: "enchantment", requested: "m15nyx", colorIdentity: ["white"], verifiedKeys: both, face: aura })).toBe("m15nyx");
  });

  it("never dresses a card that is no enchantment, asked for or at random", () => {
    const elves = { cardType: "creature", supertype: "", subtypes: ["Elf"], title: "Llanowar Elves", power: "1", toughness: "1" };
    expect(resolveGeneratedFrame({ cardType: "creature", requested: "m15nyx", colorIdentity: ["white"], verifiedKeys: both, face: elves })).toBe("m15");
    for (const roll of [0, 0.5, 0.99]) {
      expect(
        resolveGeneratedFrame({ cardType: "creature", requested: "random", colorIdentity: ["white"], verifiedKeys: both, face: elves, random: () => roll }),
      ).toBe("m15");
    }
    // …nor without a face at all.
    expect(resolveGeneratedFrame({ cardType: "creature", requested: "random", colorIdentity: ["white"], verifiedKeys: both })).toBe("m15");
  });
});

describe("imports follow the printing (the registry's era/2015+nyx rule)", () => {
  it("production has not verified the frame: this suite's unverified side is production's own list", () => {
    for (const key of FRAME_COLOR_KEYS) expect(PROD.has(frameComboKey("m15nyx", key)), key).toBe(false);
    expect(PROD.has(frameComboKey("m15", "w"))).toBe(true);
  });

  it("keeps its signature: no new rule key, the starfield gap named as before", () => {
    expect(FRAME_SIGNATURE_KEYS).toContain("era/2015+nyx");
    expect(FRAME_SIGNATURE_KEYS.filter((key) => key.startsWith("nyx/"))).toEqual(["nyx/2003"]);
    const match = frameMatchFromScryfall(ENVOY);
    expect(match).toMatchObject({
      signature: "era/2015+nyx",
      exactLabel: "M15 (2015) frame",
      status: "nearest",
      template: "m15",
      reason: "PipGlyph doesn't draw the Nyx starfield on this frame yet",
      blockedBy: "4.7",
      onceVerified: "m15nyx",
      onceVerifiedMatch: { status: "exact", reason: null },
    });
    expect(match.gaps).toEqual(["nyx"]);
  });

  it("an enchantment creature lands on its M15 frame until the Nyx frame is verified in its colour, then on it, exact", () => {
    const match = frameMatchFromScryfall(ENVOY);
    const before = withVerification(match, "w", PROD);
    expect(before).toMatchObject({ status: "nearest", template: "m15", reason: "not yet verified in white", unverified: true });
    expect(finalizeImportMatch(mapScryfallToFormPatch(ENVOY), PROD).frame_template).toBe("m15");
    // Another colour's tick never counts.
    expect(finalizeImportMatch(mapScryfallToFormPatch(ENVOY), withNyx("u", "c", "m")).frame_template).toBe("m15");
    const after = withVerification(match, "w", withNyx("w"));
    expect(after).toMatchObject({ status: "exact", template: "m15nyx", reason: null });
    expect(after.gaps).toBeUndefined();
    expect(after.unverified).toBeUndefined();
    expect(finalizeImportMatch(mapScryfallToFormPatch(ENVOY), withNyx("w")).frame_template).toBe("m15nyx");
  });

  it("a plain enchantment of Foundations 2024 on is the same printing of the frame", () => {
    const match = frameMatchFromScryfall(BLESSING);
    expect(match).toMatchObject({ signature: "era/2015+nyx", template: "m15", onceVerified: "m15nyx", onceVerifiedMatch: { status: "exact" } });
    expect(finalizeImportMatch(mapScryfallToFormPatch(BLESSING), PROD).frame_template).toBe("m15");
    expect(finalizeImportMatch(mapScryfallToFormPatch(BLESSING), withNyx("w")).frame_template).toBe("m15nyx");
  });

  it("a legendary one is exact too (the Nyx crown), a two-colour one (the pair masters), a hybrid one (the hybrid dress)", () => {
    for (const [card, colour] of [[DAXOS, "w"], [KLOTHYS, "m"], [RESCUE, "m"]] as const) {
      const match = frameMatchFromScryfall(card);
      expect(match, card.name).toMatchObject({ signature: "era/2015+nyx", onceVerified: "m15nyx", onceVerifiedMatch: { status: "exact", reason: null } });
      expect(withVerification(match, colour, withNyx(colour)), card.name).toMatchObject({ status: "exact", template: "m15nyx" });
    }
    // The import switches the pieces on, as on m15.
    const daxos = finalizeImportMatch(mapScryfallToFormPatch(DAXOS), withNyx("w"));
    expect(daxos.frame_template).toBe("m15nyx");
    expect(daxos.printed_crown).toBe(true);
    const klothys = finalizeImportMatch(mapScryfallToFormPatch(KLOTHYS), withNyx("m"));
    expect(klothys.frame_template).toBe("m15nyx");
    expect(klothys).toMatchObject({ printed_crown: true, printed_two_color: true });
  });

  it("an Enchantment Artifact is the Enchantment kind with the word, and lands there in its colour; a colourless enchantment on the silver key", () => {
    const patch = mapScryfallToFormPatch(BIDENT);
    expect({ card_type: patch.card_type, supertype: patch.supertype }).toEqual({ card_type: "enchantment", supertype: "Legendary Artifact" });
    expect(finalizeImportMatch(patch, PROD).frame_template).toBe("m15");
    expect(finalizeImportMatch(patch, withNyx("u")).frame_template).toBe("m15nyx");
    const conscription = mapScryfallToFormPatch(CONSCRIPTION);
    expect(finalizeImportMatch(conscription, withNyx("c")).frame_template).toBe("m15nyx");
  });

  it("the remix-safe gates take every landing: verified or not, the frame gate and the kind gate pass", () => {
    for (const card of [ENVOY, BLESSING, DAXOS, KLOTHYS, RESCUE, BIDENT, CONSCRIPTION]) {
      for (const verified of [PROD, NYX_VERIFIED]) {
        const patch = finalizeImportMatch(mapScryfallToFormPatch(card), verified);
        expect(frameGateError(patch.frame_template, patch.color_identity ?? [], verified), card.name).toBeNull();
        expect(
          frameKindGateError(
            patch.frame_template,
            cardFieldsFace({ card_type: patch.card_type, supertype: patch.supertype, subtypes: (patch.subtypes_text ?? "").split(", ").filter(Boolean), title: patch.title, rules_text: patch.rules_text }),
          ),
          card.name,
        ).toBeNull();
      }
    }
  });

  // What the rule must NOT move: other bodies, other dresses, other frames.
  const synthetic = (over: Record<string, unknown>) =>
    scryfallCardSchema.parse({
      id: "00000000-0000-4000-8000-0000000004f7", name: "Synthetic", layout: "normal", set: "thb", set_type: "expansion", collector_number: "400",
      frame: "2015", frame_effects: ["enchantment"], border_color: "black", full_art: false, textless: false, keywords: [],
      type_line: "Enchantment Creature — Spirit", colors: ["W"], color_identity: ["W"], mana_cost: "{1}{W}", power: "2", toughness: "2", released_at: "2020-01-24",
      oracle_text: "Flying",
      ...over,
    });

  it("a borderless, extended-art or showcase Nyx printing keeps the frame an earlier rule names", () => {
    for (const over of [
      { border_color: "borderless", frame_effects: ["enchantment", "inverted"] },
      { frame_effects: ["enchantment", "extendedart"] },
      { frame_effects: ["enchantment", "showcase"] },
    ]) {
      const match = frameMatchFromScryfall(synthetic(over));
      expect(match.signature.startsWith("era/2015"), JSON.stringify(over)).toBe(false);
      expect(match.onceVerified, JSON.stringify(over)).toBeUndefined();
      const patch = mapScryfallToFormPatch(synthetic(over));
      expect(finalizeImportMatch(patch, NYX_VERIFIED).frame_template, JSON.stringify(over)).toBe(finalizeImportMatch(patch, PROD).frame_template);
    }
  });

  it("a saga, a class, a token and the 2003 frame's Nyx never name it", () => {
    for (const over of [
      { layout: "saga", type_line: "Enchantment — Saga", power: undefined, toughness: undefined },
      { layout: "class", type_line: "Enchantment — Class", power: undefined, toughness: undefined },
      { layout: "token", set_type: "token", type_line: "Token Enchantment Creature — Spirit" },
      { frame: "2003", set: "ths", released_at: "2013-09-27" },
    ]) {
      const card = synthetic(over);
      expect(frameMatchFromScryfall(card).onceVerified, JSON.stringify(over)).not.toBe("m15nyx");
      const patch = mapScryfallToFormPatch(card);
      expect(finalizeImportMatch(patch, NYX_VERIFIED).frame_template, JSON.stringify(over)).toBe(finalizeImportMatch(patch, PROD).frame_template);
    }
  });

  it("a card whose face is no enchantment never lands there, whatever the flag says", () => {
    // The frame effect is the card's; a creature face without the word (a
    // mis-tagged printing) is refused by the frame's own kind rule.
    const card = synthetic({ type_line: "Creature — Spirit" });
    expect(frameMatchFromScryfall(card).onceVerified).toBeUndefined();
    expect(finalizeImportMatch(mapScryfallToFormPatch(card), NYX_VERIFIED).frame_template).toBe("m15");
  });

  it("a non-Nyx printing is unchanged: no enchantment effect, no rule", () => {
    const plain = synthetic({ frame_effects: [] });
    const match = frameMatchFromScryfall(plain);
    expect(match).toMatchObject({ signature: "era/2015", status: "exact", template: "m15" });
    expect(match.onceVerified).toBeUndefined();
    expect(finalizeImportMatch(mapScryfallToFormPatch(plain), NYX_VERIFIED).frame_template).toBe("m15");
  });

  it("the request log reads a logged +nyx row as drawn on the Nyx frame, and as a gap anywhere else", () => {
    expect(signatureDrawnOn("era/2015+nyx", "m15nyx")).toBe(true);
    expect(signatureDrawnOn("era/2015+nyx", "m15")).toBe(false);
  });

  it("the import chooser offers the frame to an enchantment only, and still asks while the frame isn't verified", () => {
    const patch = { card_type: "creature" as const, supertype: "Enchantment", subtypes_text: "Spirit", title: "x", rules_text: "" };
    const input = { kind: "creature" as const, colorKey: "w", verifiedKeys: EVERY };
    expect(frameFitsImport("m15nyx", { ...input, patch })).toBe(true);
    expect(frameFitsImport("m15nyx", { ...input, patch: { ...patch, supertype: "" } })).toBe(false);
    expect(frameFitsImport("m15nyx", { kind: "enchantment", colorKey: "w", verifiedKeys: EVERY, patch: { ...patch, card_type: "enchantment", supertype: "" } })).toBe(true);
    // Unverified (production today): the chooser, as before this frame.
    const today = importFramePlan(finalizeImportMatch(mapScryfallToFormPatch(ENVOY), PROD), PROD);
    expect(today.mode).toBe("choose");
    // Verified: the printing's own frame, exact — nothing to choose.
    const verified = withNyx("w");
    expect(importFramePlan(finalizeImportMatch(mapScryfallToFormPatch(ENVOY), verified), verified).mode).toBe("none");
  });
});

describe("the AI deck remix lands where the import lands (remixFrameFor)", () => {
  function remixOfPatch(patch: ScryfallImportPatch, verified: ReadonlySet<string>) {
    const result = scryfallRemixMechanics(patch, "Entry", verified);
    if (!result.ok) throw new Error(result.error);
    const m = result.mechanics;
    expect(frameGateError(m.frame_template, m.color_identity, verified)).toBeNull();
    expect(
      frameKindGateError(m.frame_template, cardFieldsFace({ card_type: m.card_type, supertype: m.supertype, subtypes: m.subtypes, title: m.title, rules_text: m.rules_text })),
    ).toBeNull();
    return m;
  }
  function importLanding(patch: ScryfallImportPatch, verified: ReadonlySet<string>) {
    const finalized = finalizeImportMatch(patch, verified);
    const { resolution } = resolveImportFrame({
      patch: finalized,
      kind: finalized.kind ?? null,
      current: { template: null, cardType: finalized.card_type ?? null, colors: finalized.color_identity ?? ["colorless"] },
      verifiedKeys: verified,
    });
    return resolution.status === "exact" || resolution.status === "frame-switched" ? resolution.template : null;
  }

  it("a Nyx printing remixes onto its M15 frame until the Nyx frame is verified in its colour, then onto it — at one credit", () => {
    const envoy = mapScryfallToFormPatch(ENVOY);
    const before = remixOfPatch(envoy, PROD);
    const after = remixOfPatch(envoy, withNyx("w"));
    expect(before.frame_template).toBe("m15");
    expect(after).toEqual({ ...before, frame_template: "m15nyx" });
    expect(after.supertype).toBe("Enchantment");
    expect(remixCreditsOf(after)).toBe(1);
    expect(remixOfPatch(envoy, withNyx("u", "b", "r", "g", "c", "m")).frame_template).toBe("m15");
  });

  it("every captured Nyx printing lands where the creator's import lands it, verified or not", () => {
    for (const card of [ENVOY, BLESSING, DAXOS, KLOTHYS, RESCUE, BIDENT, CONSCRIPTION]) {
      const patch = mapScryfallToFormPatch(card);
      for (const verified of [PROD, NYX_VERIFIED]) {
        expect(remixOfPatch(patch, verified).frame_template, card.name).toBe(importLanding(patch, verified));
      }
      expect(remixOfPatch(patch, NYX_VERIFIED).frame_template, card.name).toBe("m15nyx");
    }
  });
});

describe("reference printings", () => {
  const registry = referencesData as unknown as Record<string, { colors: Record<string, { name: string; set: string; scryfallId: string }[] | null> }>;

  it("every colour has one: plain, black-bordered, non-legendary printings that wear the starfield — a creature with its plate first", () => {
    for (const colour of FRAME_COLOR_KEYS) {
      const refs = registry.m15nyx.colors[colour] ?? [];
      expect(refs.length, colour).toBeGreaterThan(0);
      for (const ref of refs) {
        const card = scryfallCardSchema.parse(printings[ref.scryfallId]);
        expect(card.frame_effects, ref.name).toEqual(["enchantment"]);
        expect([card.frame, card.border_color, card.layout], ref.name).toEqual(["2015", "black", "normal"]);
        expect(validateReferenceForCombo(card, "m15nyx", colour).errors, ref.name).toEqual([]);
      }
    }
    for (const colour of ["w", "u", "b", "r", "g", "m"]) {
      const first = scryfallCardSchema.parse(printings[registry.m15nyx.colors[colour]![0]!.scryfallId]);
      expect(first.type_line, colour).toMatch(/^Enchantment Creature/);
      expect(first.power, colour).toBeDefined();
    }
  });

  it("a printing that is no enchantment can't be pinned to it", () => {
    const errors = validateReferenceForCombo(byName("Solemn Simulacrum"), "m15nyx", "c").errors.join(" ");
    expect(errors).not.toBe("");
  });

  it("the plain M15 frame is referenced by no Nyx printing", () => {
    for (const refs of Object.values(registry.m15.colors)) {
      for (const ref of refs ?? []) {
        const card = scryfallCardSchema.parse(printings[ref.scryfallId]);
        expect(card.frame_effects ?? [], `${ref.name} ${ref.set}`).not.toContain("enchantment");
      }
    }
  });
});
