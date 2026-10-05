import { describe, expect, it } from "vitest";
import printings from "../scryfall/fixtures/import-printings.json";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import { mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import {
  CARD_KIND_VALUES,
  KIND_DEFS,
  LAYOUT_KIND_CARD_TYPES,
  importedCardTypeForKind,
  kindFromCard,
  type CardKind,
} from "@/lib/creator/card-kinds";
import { getFrameProfile } from "@/lib/cards/template-layout";
import {
  showsDefense,
  showsLoyalty,
  showsPowerToughness,
} from "@/lib/cards/card-display";
import { frameKindGateError } from "@/lib/cards/frame-kind-gate";
import type { CardType } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 1.21 — a layout kind keeps the printed card type. The creator used to
// write the layout kind's own card type over the patch's, so Virtue of
// Loyalty WOE #38 ("Enchantment // Instant — Adventure") imported as a
// Creature, Commit // Memory AKH #211 (front "Instant") as a Sorcery, and
// Beck // Call DGM #123 (a sorcery split card) as an Instant.
// ---------------------------------------------------------------------------

const LAYOUT_KINDS = CARD_KIND_VALUES.filter((kind) => KIND_DEFS[kind].layoutTemplates);

type PrintingKey = keyof typeof printings;
const patchOf = (key: PrintingKey) =>
  mapScryfallToFormPatch(scryfallCardSchema.parse(printings[key]));

describe("LAYOUT_KIND_CARD_TYPES — what each layout template can draw", () => {
  it("covers exactly the layout kinds, each with its own card type", () => {
    expect(Object.keys(LAYOUT_KIND_CARD_TYPES).sort()).toEqual([...LAYOUT_KINDS].sort());
    for (const kind of LAYOUT_KINDS) {
      expect(LAYOUT_KIND_CARD_TYPES[kind as keyof typeof LAYOUT_KIND_CARD_TYPES], kind).toContain(
        KIND_DEFS[kind].cardType,
      );
    }
  });

  it("lists a type only where the template has the stat slot it needs", () => {
    for (const [kind, types] of Object.entries(LAYOUT_KIND_CARD_TYPES) as [CardKind, readonly CardType[]][]) {
      const profile = getFrameProfile(KIND_DEFS[kind].layoutTemplates![0]);
      for (const type of types) {
        if (showsPowerToughness(type)) expect(profile.pt, `${kind}/${type} P/T`).toBeDefined();
        if (showsLoyalty(type)) expect(profile.loyalty, `${kind}/${type} loyalty`).toBeDefined();
        if (showsDefense(type)) expect(profile.defense, `${kind}/${type} defense`).toBeDefined();
      }
    }
  });

  it("draws the P/T only for a P/T type: the adventure and flip masters paint no box of their own", () => {
    // The plate is drawn from `pt` when showsPowerToughness says so — M15's
    // on adventure, flip's own per-half plates (layout v38, TODO 4.21a: its
    // second face's with the back face's P/T) — so an enchantment on these
    // frames simply has none: their Card Conjurer masters (the frames
    // bucket) paint no P/T box. A split / aftermath / saga frame has no P/T
    // slot at all.
    expect(getFrameProfile("adventure").pt).toBeDefined();
    expect(getFrameProfile("flip").pt).toBeDefined();
    expect(getFrameProfile("adventure").pt?.plateAssetPathTemplate).toBe("/frames/m15/pt/{color}.png");
    expect(getFrameProfile("flip").pt?.plateAssetPathTemplate).toBe("/frames/flip/pt/{color}-top.png");
    expect(getFrameProfile("flip").secondFace?.pt?.plateAssetPathTemplate).toBe("/frames/flip/pt/{color}-bottom.png");
    expect(getFrameProfile("saga").pt).toBeUndefined();
    expect(showsPowerToughness("enchantment")).toBe(false);
  });

  it("never lists planeswalker or battle (no layout frame has a loyalty or defense slot)", () => {
    for (const types of Object.values(LAYOUT_KIND_CARD_TYPES)) {
      expect(types).not.toContain("planeswalker");
      expect(types).not.toContain("battle");
    }
  });
});

describe("importedCardTypeForKind", () => {
  it("keeps the printed type of the three TODO 1.21 fixtures", () => {
    const virtue = patchOf("woe-38");
    expect(virtue.kind).toBe("adventure");
    expect(importedCardTypeForKind(virtue.kind!, virtue.card_type)).toBe("enchantment");
    const commit = patchOf("akh-211");
    expect(commit.kind).toBe("aftermath");
    expect(importedCardTypeForKind(commit.kind!, commit.card_type)).toBe("instant");
    const beck = patchOf("dgm-123");
    expect(beck.kind).toBe("split");
    expect(importedCardTypeForKind(beck.kind!, beck.card_type)).toBe("sorcery");
  });

  it("leaves the kinds whose printed type is already the kind's alone", () => {
    for (const key of ["eld-115", "tdm-40", "chk-202", "dmr-215", "neo-141", "mh2-259", "fin-1"] as const) {
      const patch = patchOf(key);
      expect(importedCardTypeForKind(patch.kind!, patch.card_type), key).toBe(
        KIND_DEFS[patch.kind!].cardType,
      );
    }
  });

  it("falls back to the kind's own type when the template can't draw the printed one", () => {
    expect(importedCardTypeForKind("split", "creature")).toBe("instant");
    expect(importedCardTypeForKind("adventure", "planeswalker")).toBe("creature");
    expect(importedCardTypeForKind("saga", "creature")).toBe("enchantment");
    expect(importedCardTypeForKind("aftermath", undefined)).toBe("sorcery");
  });

  it("a standard kind is always its own card type", () => {
    expect(importedCardTypeForKind("creature", "enchantment")).toBe("creature");
    expect(importedCardTypeForKind("land", "land")).toBe("land");
  });

  it("never changes the kind: the layout template decides it, whatever the type", () => {
    for (const [kind, types] of Object.entries(LAYOUT_KIND_CARD_TYPES) as [CardKind, readonly CardType[]][]) {
      // The modal kind's bodies are 5.1b's (TODO 5.2 names the kind): no
      // template decides it yet.
      if (kind === "mdfc") {
        expect(KIND_DEFS[kind].layoutTemplates).toEqual([]);
        continue;
      }
      for (const type of types) {
        expect(kindFromCard(type, KIND_DEFS[kind].layoutTemplates![0])).toBe(kind);
      }
    }
  });
});

describe("the save's kind gate accepts a layout card with its printed type", () => {
  it.each([
    ["adventure", "enchantment"],
    ["adventure", "artifact"],
    ["adventure", "land"],
    ["aftermath", "instant"],
    ["split", "sorcery"],
    ["flip", "token"],
  ] as const)("%s frame + %s", (template, cardType) => {
    // createCardAction / updateCardAction run frameKindGateError on the
    // payload; the kind comes from the layout template.
    expect(frameKindGateError(template, { cardType, title: "Any" })).toBeNull();
  });
});
