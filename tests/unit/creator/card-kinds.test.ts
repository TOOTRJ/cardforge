import { describe, expect, it } from "vitest";
import {
  BASIC_ONLY_FRAME_REASON,
  CARD_KIND_VALUES,
  KIND_DEFS,
  framesForKind,
  baseFrameFor,
  basicLandSeedForColorKey,
  isSeedableLandIdentity,
  isSingleBasicLand,
  kindFromCard,
  landIdentityHasBasicSeed,
  planKindChange,
  shouldClearBasicSeedForTitle,
  templateIsBasicOnly,
  templateRefusesKind,
  templateSupportsKind,
  toBasicLandIdentity,
  toNonbasicLandIdentity,
  withArtifactWord,
  withoutArtifactWord,
  type CardKind,
} from "@/lib/creator/card-kinds";
import { FRAME_COLOR_KEYS, frameComboKey } from "@/lib/cards/frame-reference-registry";
import {
  FRAME_SET_ERA,
  FRAME_SET_LABELS,
  FRAME_TEMPLATE_SET,
  FRAME_TEMPLATE_VALUES,
  isPremiumFrameTemplate,
} from "@/types/card";
import { normalizeColorSelection } from "@/lib/creator/card-fields";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { showsPowerToughness } from "@/lib/cards/card-display";

const NO_VERIFIED: ReadonlySet<string> = new Set();

describe("kindFromCard", () => {
  it("derives the kind from the template for layout kinds (template wins)", () => {
    expect(kindFromCard("enchantment", "saga")).toBe("saga");
    expect(kindFromCard("creature", "adventure")).toBe("adventure");
    expect(kindFromCard("instant", "split")).toBe("split");
    expect(kindFromCard("sorcery", "aftermath")).toBe("aftermath");
    expect(kindFromCard("creature", "flip")).toBe("flip");
    // Even a mismatched stored card_type can't shake the template's kind.
    expect(kindFromCard("creature", "saga")).toBe("saga");
  });

  it("derives the kind from card_type for standards, skins, and showcase", () => {
    expect(kindFromCard("creature", "m15")).toBe("creature");
    expect(kindFromCard("planeswalker", "m15pw")).toBe("planeswalker");
    expect(kindFromCard("creature", "m15snow")).toBe("creature");
    expect(kindFromCard("instant", "m15devoid")).toBe("instant");
    expect(kindFromCard("creature", "lotr")).toBe("creature");
    expect(kindFromCard("land", "alphaland")).toBe("land");
  });

  it("maps the legacy 'spell' card_type to sorcery without needing a template", () => {
    expect(kindFromCard("spell", "m15")).toBe("sorcery");
    expect(kindFromCard("spell", undefined)).toBe("sorcery");
  });

  it("defaults to creature for empty type + unknown/retired templates", () => {
    expect(kindFromCard("", undefined)).toBe("creature");
    expect(kindFromCard(null, "regular")).toBe("creature");
  });

  it("round-trips every kind through planKindChange's patch", () => {
    for (const kind of CARD_KIND_VALUES) {
      const plan = planKindChange(kind, { cardType: "creature", template: "m15" });
      expect(kindFromCard(plan.patch.card_type, plan.patch.template)).toBe(kind);
    }
  });
});

describe("framesForKind", () => {
  it("yields at least one frame for every kind, even with nothing verified", () => {
    for (const kind of CARD_KIND_VALUES) {
      expect(framesForKind(kind, NO_VERIFIED).length).toBeGreaterThan(0);
    }
  });

  it("never leaks an era that lacks the kind (no classic/retro/modern planeswalker)", () => {
    for (const kind of ["planeswalker", "battle"] as CardKind[]) {
      const eras = framesForKind(kind, NO_VERIFIED).map((f) => f.era);
      expect(eras).not.toContain("classic");
      expect(eras).not.toContain("retro");
      expect(eras).not.toContain("modern");
    }
    // Tokens exist in classic + m15 but not retro/modern.
    const tokenEras = framesForKind("token", NO_VERIFIED).map((f) => f.era);
    expect(tokenEras).toContain("classic");
    expect(tokenEras).toContain("m15");
    expect(tokenEras).not.toContain("retro");
    expect(tokenEras).not.toContain("modern");
  });

  it("gives layout kinds exactly their template family, nothing else", () => {
    expect(framesForKind("saga", NO_VERIFIED).map((f) => f.template)).toEqual([
      "saga",
    ]);
    expect(framesForKind("split", NO_VERIFIED).map((f) => f.template)).toEqual([
      "split",
    ]);
    // No skins, no showcase for layout kinds.
    for (const f of framesForKind("adventure", NO_VERIFIED)) {
      expect(f.group).toBe("layout");
    }
  });

  it("brings each era standard exactly its own skin variants", () => {
    const skinsFor = (kind: CardKind) =>
      framesForKind(kind, NO_VERIFIED)
        .filter((f) => f.group === "skin")
        .map((f) => f.template);
    // A creature also borrows the M15 artifact frame (TODO 1.7) and its
    // borderless dress (4.32).
    expect(skinsFor("creature")).toEqual([
      "m15snow",
      "m15devoid",
      "m15borderless",
      "m15artifact",
      "m15borderlessartifact",
    ]);
    for (const kind of ["instant", "sorcery", "enchantment"] as CardKind[]) {
      expect(skinsFor(kind)).toEqual(["m15snow", "m15devoid", "m15borderless"]);
    }
    expect(skinsFor("artifact")).toEqual(["m15borderlessartifact"]);
    expect(skinsFor("land")).toEqual(["m15snowland"]);
    expect(skinsFor("token")).toEqual(["m15tokenartifact"]);
    // Standards with their own geometry and no skin set stay bare.
    for (const kind of ["planeswalker", "battle"] as CardKind[]) {
      expect(skinsFor(kind)).toEqual([]);
    }
  });

  it("appends showcase treatments for every standard kind", () => {
    const groups = framesForKind("creature", NO_VERIFIED).map((f) => f.group);
    expect(groups).toContain("showcase");
    const eras = framesForKind("land", NO_VERIFIED).map((f) => f.era);
    expect(eras).toContain("showcase");
  });

  it("gates every combo on verification — nothing is grandfathered", () => {
    // With nothing verified, EVERY frame tile is gated.
    for (const f of framesForKind("creature", NO_VERIFIED)) {
      expect(f.availableColorKeys).toEqual([]);
    }

    // Publishing a combo makes exactly that color available.
    const oneCombo = new Set([frameComboKey("saga", "g")]);
    const saga = framesForKind("saga", oneCombo)[0];
    expect(saga.availableColorKeys).toEqual(["g"]);
    const m15 = framesForKind(
      "creature",
      new Set([frameComboKey("m15", "w")]),
    ).find((f) => f.template === "m15");
    expect(m15?.availableColorKeys).toEqual(["w"]);
  });
});

describe("planKindChange", () => {
  it("remaps within the current era when it has an equivalent frame", () => {
    expect(
      planKindChange("planeswalker", { cardType: "creature", template: "m15" }),
    ).toEqual({
      action: "apply",
      patch: { card_type: "planeswalker", template: "m15pw" },
    });
    expect(
      planKindChange("land", { cardType: "creature", template: "retro" }),
    ).toEqual({
      action: "apply",
      patch: { card_type: "land", template: "retroland" },
    });
  });

  it("asks before leaving an era that lacks the kind — never a silent fallback", () => {
    const plan = planKindChange("planeswalker", {
      cardType: "creature",
      template: "agclassic",
    });
    expect(plan.action).toBe("confirm");
    if (plan.action === "confirm") {
      expect(plan.reason).toBe("era-lacks-kind");
      expect(plan.message).toContain("Classic");
      expect(plan.patch).toEqual({
        card_type: "planeswalker",
        template: "m15pw",
      });
    }

    expect(
      planKindChange("battle", { cardType: "creature", template: "retro" })
        .action,
    ).toBe("confirm");
    expect(
      planKindChange("token", { cardType: "creature", template: "modern" })
        .action,
    ).toBe("confirm");
    // Showcase frames have no type mapping — any standard-kind change asks.
    expect(
      planKindChange("land", { cardType: "creature", template: "lotr" }).action,
    ).toBe("confirm");
  });

  it("applies layout kinds deterministically and force-enables the inline second face", () => {
    for (const kind of ["adventure", "split", "aftermath", "flip"] as CardKind[]) {
      const plan = planKindChange(kind, {
        cardType: "creature",
        template: "agclassic",
      });
      expect(plan.action).toBe("apply");
      expect(plan.patch.template).toBe(KIND_DEFS[kind].layoutTemplates?.[0]);
      expect(plan.patch.has_back_face).toBe(true);
    }
    // Saga is a layout kind but its face is single — no forced back face.
    const saga = planKindChange("saga", {
      cardType: "creature",
      template: "m15",
    });
    expect(saga.action).toBe("apply");
    expect(saga.patch).toEqual({ card_type: "enchantment", template: "saga" });
  });

  it("tolerates legacy/unknown current templates by normalizing to the default frame", () => {
    const plan = planKindChange("land", {
      cardType: "creature",
      template: "regular",
    });
    expect(plan).toEqual({
      action: "apply",
      patch: { card_type: "land", template: "m15land" },
    });
  });
});

describe("basic-land auto-identity", () => {
  it("seeds the basic matching the frame color, none for multicolor", () => {
    // Wastes is "Basic Land" with NO land type in the rules.
    expect(basicLandSeedForColorKey("c")).toEqual({
      title: "Wastes",
      supertype: "Basic",
      subtypes_text: "",
    });
    expect(basicLandSeedForColorKey("g")).toEqual({
      title: "Forest",
      supertype: "Basic",
      subtypes_text: "Forest",
    });
    expect(basicLandSeedForColorKey("g")?.title).toBe("Forest");
    expect(basicLandSeedForColorKey("m")).toBeNull();
    expect(basicLandSeedForColorKey("nope")).toBeNull();
  });

  it("treats empty or exactly-seeded identities as rewritable, user text as owned", () => {
    expect(
      isSeedableLandIdentity({ title: "", supertype: "", subtypes_text: "" }),
    ).toBe(true);
    expect(
      isSeedableLandIdentity({
        title: "Forest",
        supertype: "Basic",
        subtypes_text: "Forest",
      }),
    ).toBe(true);
    // A renamed card is user-owned even with the seeded subtype intact.
    expect(
      isSeedableLandIdentity({
        title: "Mystic Grove",
        supertype: "Basic",
        subtypes_text: "Forest",
      }),
    ).toBe(false);
    // Mixed seed (title from one basic, subtype from another) is user-owned.
    expect(
      isSeedableLandIdentity({
        title: "Forest",
        supertype: "Basic",
        subtypes_text: "Island",
      }),
    ).toBe(false);
    expect(
      isSeedableLandIdentity({
        title: "Forest",
        supertype: "",
        subtypes_text: "Forest",
      }),
    ).toBe(false);
    // The Wastes seed (no subtype) and a legacy Wastes draft are both seeds.
    expect(
      isSeedableLandIdentity({ title: "Wastes", supertype: "Basic", subtypes_text: "" }),
    ).toBe(true);
    expect(
      isSeedableLandIdentity({ title: "Wastes", supertype: "Basic", subtypes_text: "Wastes" }),
    ).toBe(true);
  });

  it("REGRESSION 2026-09-14: renaming a seeded basic drops the seed so the text box appears", () => {
    const renamed = { title: "Command Tower", supertype: "Basic", subtypes_text: "Plains" };
    expect(landIdentityHasBasicSeed(renamed)).toBe(true);
    expect(shouldClearBasicSeedForTitle(renamed)).toBe(true);
    expect(toNonbasicLandIdentity(renamed)).toEqual({
      title: "Command Tower",
      supertype: "",
      subtypes_text: "",
    });
    // A basic's own name keeps the seed; an empty title changes nothing yet.
    expect(shouldClearBasicSeedForTitle({ title: "Forest", supertype: "Basic", subtypes_text: "Forest" })).toBe(false);
    expect(shouldClearBasicSeedForTitle({ title: "Snow-Covered Forest", supertype: "Basic", subtypes_text: "Forest" })).toBe(false);
    expect(shouldClearBasicSeedForTitle({ title: "", supertype: "Basic", subtypes_text: "Forest" })).toBe(false);
    // User-typed identity is never a seed residue.
    expect(landIdentityHasBasicSeed({ title: "Breeding Pool", supertype: "Basic", subtypes_text: "Forest, Island" })).toBe(false);
    expect(landIdentityHasBasicSeed({ title: "X", supertype: "Legendary", subtypes_text: "Forest" })).toBe(false);
  });

  it("toNonbasic keeps user-typed subtypes and other supertypes; toBasic adds Basic + the color's type", () => {
    expect(
      toNonbasicLandIdentity({ title: "X", supertype: "Legendary Basic", subtypes_text: "Forest, Island" }),
    ).toEqual({ title: "X", supertype: "Legendary", subtypes_text: "Forest, Island" });
    expect(
      toBasicLandIdentity({ title: "Elven Grove", supertype: "", subtypes_text: "" }, "g"),
    ).toEqual({ title: "Elven Grove", supertype: "Basic", subtypes_text: "Forest" });
    expect(
      toBasicLandIdentity({ title: "X", supertype: "Legendary", subtypes_text: "Elf" }, "r"),
    ).toEqual({ title: "X", supertype: "Basic Legendary", subtypes_text: "Mountain, Elf" });
    // Already has a basic type: no duplicate; Wastes adds no subtype.
    expect(
      toBasicLandIdentity({ title: "X", supertype: "", subtypes_text: "Island" }, "g"),
    ).toEqual({ title: "X", supertype: "Basic", subtypes_text: "Island" });
    expect(
      toBasicLandIdentity({ title: "Wastes", supertype: "", subtypes_text: "" }, "c"),
    ).toEqual({ title: "Wastes", supertype: "Basic", subtypes_text: "" });
    expect(toBasicLandIdentity({ title: "X", supertype: "", subtypes_text: "" }, "m")).toBeNull();
  });
});

describe("normalizeColorSelection", () => {
  it("collapses 2+ real colors to multicolor, passes singles through", () => {
    expect(normalizeColorSelection(["white", "blue"])).toEqual(["multicolor"]);
    expect(normalizeColorSelection(["red"])).toEqual(["red"]);
    expect(normalizeColorSelection(["multicolor"])).toEqual(["multicolor"]);
    expect(normalizeColorSelection(["colorless"])).toEqual(["colorless"]);
    expect(normalizeColorSelection([])).toEqual([]);
    // A real color beside colorless keeps the real color.
    expect(normalizeColorSelection(["colorless", "green"])).toEqual(["green"]);
    // Duplicates don't fake a multicolor.
    expect(normalizeColorSelection(["red", "red"])).toEqual(["red"]);
  });
});

describe("baseFrameFor", () => {
  it("maps skins to their base and showcase to the kind's M15 standard", () => {
    expect(baseFrameFor("creature", "m15snow")).toBe("m15");
    expect(baseFrameFor("creature", "m15devoid")).toBe("m15");
    expect(baseFrameFor("land", "m15snowland")).toBe("m15land");
    expect(baseFrameFor("token", "m15tokenartifact")).toBe("m15token");
    expect(baseFrameFor("creature", "lotr")).toBe("m15");
    expect(baseFrameFor("land", "avatar")).toBe("m15land");
    // Standards and layouts are their own base.
    expect(baseFrameFor("creature", "retro")).toBe("retro");
    expect(baseFrameFor("creature", "m15")).toBe("m15");
    expect(baseFrameFor("saga", "saga")).toBe("saga");
    // TODO 1.7: the artifact frame is a creature's variation of m15, but an
    // artifact's own standard.
    expect(baseFrameFor("creature", "m15artifact")).toBe("m15");
    expect(baseFrameFor("artifact", "m15artifact")).toBe("m15artifact");
  });
});

describe("templateSupportsKind", () => {
  it("answers from the kind's full gallery, ignoring verification", () => {
    expect(templateSupportsKind("saga", "saga")).toBe(true);
    expect(templateSupportsKind("saga", "creature")).toBe(false);
    expect(templateSupportsKind("m15pw", "planeswalker")).toBe(true);
    expect(templateSupportsKind("m15", "planeswalker")).toBe(false);
    expect(templateSupportsKind("m15artifact", "artifact")).toBe(true);
    // An Artifact Creature is a creature on the artifact frame (TODO 1.7);
    // no other kind borrows it.
    expect(templateSupportsKind("m15artifact", "creature")).toBe(true);
    // …with its P/T box: the artifact frame is M15's geometry with its own
    // P/T plates, and the renderers show P/T for the creature card type.
    expect(getFrameProfile("m15artifact").pt?.plateAssetPathTemplate).toBe(
      "/frames/m15artifact/pt/{color}.png",
    );
    expect(showsPowerToughness("creature")).toBe(true);
    for (const kind of ["instant", "sorcery", "enchantment", "land", "token", "planeswalker"] as const) {
      expect(templateSupportsKind("m15artifact", kind)).toBe(false);
    }
    // Skins ride with their base kind; showcase dresses any standard kind.
    expect(templateSupportsKind("m15snow", "creature")).toBe(true);
    expect(templateSupportsKind("lotr", "instant")).toBe(true);
    // Type-restricted showcase treatments stay restricted.
    expect(templateSupportsKind("nyx", "creature")).toBe(false);
    expect(templateSupportsKind("nyx", "enchantment")).toBe(true);
    expect(templateSupportsKind("fullartland", "land")).toBe(true);
    expect(templateSupportsKind("fullartland", "creature")).toBe(false);
  });

  // TODO 0.26: these three profiles have no loyalty slot, no loyaltyRows and
  // no defense shield, so a planeswalker or a battle on them prints no stat.
  it("keeps planeswalkers and battles off the frames with no stat overlay", () => {
    expect(templateSupportsKind("fullart", "planeswalker")).toBe(false);
    expect(templateSupportsKind("m15textless", "battle")).toBe(false);
    for (const template of ["fullart", "m15textless", "extendedart"] as const) {
      expect(templateSupportsKind(template, "planeswalker")).toBe(false);
      expect(templateSupportsKind(template, "battle")).toBe(false);
      // Every other standard kind still gets them.
      for (const kind of ["creature", "instant", "sorcery", "artifact", "enchantment", "land", "token"] as const) {
        expect(templateSupportsKind(template, kind)).toBe(true);
      }
    }
    // The planeswalker/battle galleries lose exactly those three.
    const pw = framesForKind("planeswalker", NO_VERIFIED).map((f) => f.template);
    expect(pw).toContain("m15pw");
    expect(pw).not.toContain("fullart");
    expect(pw).not.toContain("m15textless");
    expect(pw).not.toContain("extendedart");
  });
});

describe("templateRefusesKind", () => {
  it("refuses only what a showcase restriction leaves out", () => {
    expect(templateRefusesKind("fullart", "planeswalker")).toBe(true);
    expect(templateRefusesKind("extendedart", "battle")).toBe(true);
    expect(templateRefusesKind("nyx", "creature")).toBe(true);
    expect(templateRefusesKind("fullartland", "creature")).toBe(true);
    expect(templateRefusesKind("fullart", "creature")).toBe(false);
    expect(templateRefusesKind("lotr", "planeswalker")).toBe(false);
  });

  it("never refuses a border-era frame an off-kind legacy card sits on", () => {
    // templateSupportsKind says no (the gallery offers m15artifact/m15token)…
    expect(templateSupportsKind("m15", "artifact")).toBe(false);
    expect(templateSupportsKind("m15", "token")).toBe(false);
    // …but the server gate must keep those saved cards savable.
    expect(templateRefusesKind("m15", "artifact")).toBe(false);
    expect(templateRefusesKind("m15", "token")).toBe(false);
    expect(templateRefusesKind("saga", "creature")).toBe(false);
  });
});

describe("basic-only frames", () => {
  const land = (supertype: string, subtypes: string[], title: string, rulesText = "") => ({
    cardType: "land",
    supertype,
    subtypes,
    title,
    rulesText,
  });

  it("flags only the full-art basic land frames", () => {
    expect(templateIsBasicOnly("fullartland")).toBe(true);
    expect(templateIsBasicOnly("m15fullartland")).toBe(true);
    for (const template of ["m15land", "m15textlessland", "expeditionland", "fullart", "m15"] as const) {
      expect(templateIsBasicOnly(template)).toBe(false);
    }
    expect(BASIC_ONLY_FRAME_REASON).toBe("Full-art basic frames are for basic lands");
  });

  it("recognises one basic land, Wastes and snow basics included", () => {
    expect(isSingleBasicLand(land("Basic", ["Plains"], "Plains"))).toBe(true);
    expect(isSingleBasicLand(land("Basic Snow", ["Island"], "Snow-Covered Island"))).toBe(true);
    expect(isSingleBasicLand(land("Basic", [], "Wastes"))).toBe(true);
    // Legacy/AI shape the renderers already print as a basic.
    expect(isSingleBasicLand(land("", ["Forest"], "Forest"))).toBe(true);
  });

  it("keeps nonbasics and dual-typed lands out", () => {
    // Hallowed Fountain — the shockland from the full-art research bake C.
    expect(
      isSingleBasicLand(
        land("", ["Plains", "Island"], "Hallowed Fountain", "({T}: Add {W} or {U}.)"),
      ),
    ).toBe(false);
    // A dual with no rules text still isn't one basic (3b.4)…
    expect(isSingleBasicLand(land("", ["Plains", "Island"], "Tundra"))).toBe(false);
    // …nor is a Basic supertype carrying two basic types.
    expect(isSingleBasicLand(land("Basic", ["Plains", "Island"], "Plains"))).toBe(false);
    expect(isSingleBasicLand(land("", [], "Command Tower", "{T}: Add one mana."))).toBe(false);
    expect(isSingleBasicLand({ ...land("Basic", ["Plains"], "Plains"), cardType: "creature" })).toBe(false);
  });
});

// TODO 1.7: picking the Artifact variation on a creature makes it an
// Artifact Creature (the Card step writes the word), and leaving it undoes it.
describe("withArtifactWord / withoutArtifactWord", () => {
  it("adds Artifact after the other supertype words, once", () => {
    expect(withArtifactWord("")).toBe("Artifact");
    expect(withArtifactWord(undefined)).toBe("Artifact");
    expect(withArtifactWord("Legendary")).toBe("Legendary Artifact");
    expect(withArtifactWord("Legendary  Snow")).toBe("Legendary Snow Artifact");
    expect(withArtifactWord("Legendary Artifact")).toBe("Legendary Artifact");
    expect(withArtifactWord("artifact")).toBe("artifact");
  });

  it("takes out only the Artifact word", () => {
    expect(withoutArtifactWord("Legendary Artifact")).toBe("Legendary");
    expect(withoutArtifactWord("Artifact")).toBe("");
    expect(withoutArtifactWord("Snow Artifact")).toBe("Snow");
    expect(withoutArtifactWord("Legendary")).toBe("Legendary");
    expect(withoutArtifactWord(null)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Frames plan 4.32 (the borderless M15 frame) and 4.39 (full-art basics).
// ---------------------------------------------------------------------------

describe("the borderless M15 frame (4.32)", () => {
  const all = new Set(FRAME_TEMPLATE_VALUES.flatMap((t) => FRAME_COLOR_KEYS.map((k) => frameComboKey(t, k))));

  it("is a skin of the M15 standard (and of the M15 artifact frame), in its own M15-era Borderless set", () => {
    expect(FRAME_TEMPLATE_SET.m15borderless).toBe("borderless");
    expect(FRAME_TEMPLATE_SET.m15borderlessartifact).toBe("borderless");
    expect(FRAME_SET_LABELS.borderless).toBe("Borderless");
    expect(FRAME_SET_ERA.borderless).toBe("m15");
    expect(baseFrameFor("creature", "m15borderless")).toBe("m15");
    expect(baseFrameFor("instant", "m15borderless")).toBe("m15");
    expect(baseFrameFor("artifact", "m15borderlessartifact")).toBe("m15artifact");
    // An Artifact Creature borrows the artifact dress under its own M15
    // standard, like m15artifact (1.7).
    expect(baseFrameFor("creature", "m15borderlessartifact")).toBe("m15");
    const creature = framesForKind("creature", all).filter((f) => f.group === "skin").map((f) => f.template);
    expect(creature).toContain("m15borderless");
    // Offered once, never also as a showcase treatment.
    for (const kind of CARD_KIND_VALUES) {
      const templates = framesForKind(kind, all).map((f) => f.template);
      expect(new Set(templates).size, kind).toBe(templates.length);
    }
  });

  it("dresses creature, instant, sorcery, enchantment and artifact only", () => {
    const allowed: CardKind[] = ["creature", "instant", "sorcery", "enchantment"];
    for (const kind of CARD_KIND_VALUES) {
      expect(templateSupportsKind("m15borderless", kind), kind).toBe(allowed.includes(kind));
    }
    expect(templateSupportsKind("m15borderlessartifact", "artifact")).toBe(true);
    expect(templateSupportsKind("m15borderlessartifact", "creature")).toBe(true);
    // The server refuses every other kind (CC's pack has no planeswalker,
    // land, token or battle frame — 4.33 / 4.34 / 4.37) and lets a
    // coloured artifact keep the colour frame.
    for (const kind of ["planeswalker", "land", "token", "battle", "saga", "adventure"] as CardKind[]) {
      expect(templateRefusesKind("m15borderless", kind), kind).toBe(true);
      expect(templateRefusesKind("m15borderlessartifact", kind), kind).toBe(true);
    }
    for (const kind of [...allowed, "artifact"] as CardKind[]) {
      expect(templateRefusesKind("m15borderless", kind), kind).toBe(false);
    }
    expect(templateRefusesKind("m15borderlessartifact", "instant")).toBe(true);
    // …but an Artifact Creature keeps the artifact dress it borrows.
    expect(templateRefusesKind("m15borderlessartifact", "creature")).toBe(false);
    expect(templateRefusesKind("m15borderlessartifact", "artifact")).toBe(false);
  });

  it("a kind change keeps the M15 era (no prompt), landing on the kind's M15 standard", () => {
    expect(planKindChange("instant", { cardType: "creature", template: "m15borderless" })).toEqual({
      action: "apply",
      patch: { card_type: "instant", template: "m15" },
    });
  });

  it("is never premium: Wizards trade dress stays free", () => {
    for (const template of ["m15borderless", "m15borderlessartifact", "m15fullartland", "fullartland"] as const) {
      expect(isPremiumFrameTemplate(template), template).toBe(false);
    }
  });
});

describe("the full-art basics (4.39)", () => {
  it("are showcase treatments of the land kind in the Full Art set, basic lands only", () => {
    for (const template of ["m15fullartland", "fullartland"] as const) {
      expect(FRAME_TEMPLATE_SET[template]).toBe("fullartset");
      expect(baseFrameFor("land", template)).toBe("m15land");
      expect(templateIsBasicOnly(template)).toBe(true);
      for (const kind of CARD_KIND_VALUES) {
        expect(templateSupportsKind(template, kind), `${template} ${kind}`).toBe(kind === "land");
      }
    }
  });
});
