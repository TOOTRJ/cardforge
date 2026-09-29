import { describe, expect, it } from "vitest";
import {
  TOKEN_PICKER_WORDS,
  followTokenName,
  framesForKind,
  isTypeWordDress,
  supertypeEnteringToken,
  supertypeLeavingToken,
  toggleTokenWord,
  tokenNameFromSubtypes,
  tokenOtherWordsOf,
  tokenPickerWordsOf,
  typeWordFrameFits,
  typeWordFrameFor,
  withTokenOtherWords,
} from "@/lib/creator/card-kinds";
import { resolveGeneratedFrame } from "@/lib/creator/frame-random";
import { resolvePublishedFrame } from "@/lib/creator/frame-resolve";
import { defaultValuesFor, formSupertypeOf } from "@/lib/creator/card-fields";
import { statVisibility } from "@/lib/creator/steps";
import { buildTypeLine } from "@/lib/cards/card-display";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import type { Card } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 3b.15 — the token kind's type picker: Creature · Artifact ·
// Enchantment, plus Legendary. Each toggle writes and removes only its own
// word in `supertype`, in printed order; none on is a Copy's bare "Token";
// the frame follows the Artifact word; the name follows the subtypes.
// ---------------------------------------------------------------------------

const keys = (...pairs: Array<[string, string]>) =>
  new Set(pairs.map(([template, color]) => frameComboKey(template as never, color)));

describe("the token picker's toggles", () => {
  it("offers Creature, Artifact, Enchantment and Legendary — no Emblem until 6.23", () => {
    expect(TOKEN_PICKER_WORDS).toEqual(["Creature", "Artifact", "Enchantment", "Legendary"]);
  });

  it("each toggle writes only its own word, in printed order", () => {
    // Creature is on for a new token.
    let supertype = supertypeEnteringToken("");
    expect(supertype).toBe("Creature");
    supertype = toggleTokenWord(supertype, "Artifact", true);
    expect(supertype).toBe("Artifact Creature");
    supertype = toggleTokenWord(supertype, "Enchantment", true);
    expect(supertype).toBe("Enchantment Artifact Creature"); // TEOC #13
    supertype = toggleTokenWord(supertype, "Legendary", true);
    expect(supertype).toBe("Legendary Enchantment Artifact Creature");
    expect(tokenPickerWordsOf(supertype)).toEqual(["Creature", "Artifact", "Enchantment", "Legendary"]);
  });

  it("each toggle removes only its own word", () => {
    const all = "Legendary Enchantment Artifact Creature";
    expect(toggleTokenWord(all, "Creature", false)).toBe("Legendary Enchantment Artifact");
    expect(toggleTokenWord(all, "Artifact", false)).toBe("Legendary Enchantment Creature");
    expect(toggleTokenWord(all, "Enchantment", false)).toBe("Legendary Artifact Creature"); // TNEO #14
    expect(toggleTokenWord(all, "Legendary", false)).toBe("Enchantment Artifact Creature");
  });

  it("a Treasure: Creature off, Artifact on", () => {
    const treasure = toggleTokenWord(toggleTokenWord("Creature", "Creature", false), "Artifact", true);
    expect(treasure).toBe("Artifact");
    expect(buildTypeLine({ cardType: "token", supertype: treasure, subtypes: ["Treasure"] })).toBe(
      "Token Artifact — Treasure",
    );
    // No P/T input.
    expect(statVisibility("token", ["Treasure"], treasure).pt).toBe(false);
  });

  it("none on is allowed — a Copy's bare \"Token\"", () => {
    const copy = toggleTokenWord("Creature", "Creature", false);
    expect(copy).toBe("");
    expect(tokenPickerWordsOf(copy)).toEqual([]);
    expect(buildTypeLine({ cardType: "token", supertype: copy, subtypes: [] })).toBe("Token");
    expect(statVisibility("token", [], copy).pt).toBe(false);
  });

  it("keeps every word it doesn't own (an import's Land, Snow, Basic)", () => {
    expect(toggleTokenWord("Land", "Creature", true)).toBe("Land Creature"); // TBRO #3
    expect(toggleTokenWord("Land Creature", "Creature", false)).toBe("Land");
    expect(toggleTokenWord("Snow Creature", "Legendary", true)).toBe("Legendary Snow Creature");
    expect(tokenPickerWordsOf("Legendary Snow Artifact")).toEqual(["Artifact", "Legendary"]);
    expect(tokenPickerWordsOf("Basic")).toEqual([]);
  });

  it("an imported line lights its own toggles", () => {
    expect(tokenPickerWordsOf("Enchantment Creature")).toEqual(["Creature", "Enchantment"]);
    expect(tokenPickerWordsOf("legendary artifact")).toEqual(["Artifact", "Legendary"]);
  });
});

describe("the token's free Supertype field edits only the words the picker doesn't own", () => {
  it("shows the other words, never Legendary / Enchantment / Artifact / Creature", () => {
    expect(tokenOtherWordsOf("Creature")).toBe("");
    expect(tokenOtherWordsOf("Legendary Snow Artifact Creature")).toBe("Snow");
    expect(tokenOtherWordsOf("Basic Legendary Snow Creature")).toBe("Basic Snow");
    // Any case, as the picker reads them (an old hand-typed row).
    expect(tokenOtherWordsOf("legendary  land creature")).toBe("land");
    expect(tokenOtherWordsOf(null)).toBe("");
  });

  it("writes the typed words back merged in printed order with the picker's words", () => {
    expect(withTokenOtherWords("Creature", "Snow")).toBe("Snow Creature");
    expect(withTokenOtherWords("Legendary Artifact Creature", "Snow")).toBe("Legendary Snow Artifact Creature");
    expect(withTokenOtherWords("Legendary Creature", "Basic Snow")).toBe("Basic Legendary Snow Creature");
    expect(withTokenOtherWords("Artifact", "Land")).toBe("Artifact Land");
    // Clearing the field keeps the picker's words.
    expect(withTokenOtherWords("Legendary Snow Enchantment Creature", "")).toBe("Legendary Enchantment Creature");
    // Spacing is the field's; the words are what count.
    expect(withTokenOtherWords("Creature", "  Snow   ")).toBe("Snow Creature");
  });

  it("never lets the field add or drop a picker word while the user types", () => {
    // "Legendary" typed here does not write (the toggle is its control) …
    expect(withTokenOtherWords("Creature", "Snow Legendary")).toBe("Snow Creature");
    // … and a picker word that is on stays on when the field doesn't show it.
    expect(withTokenOtherWords("Artifact Creature", "Snow")).toBe("Snow Artifact Creature");
    // A word that merely starts like one is an ordinary word.
    expect(withTokenOtherWords("", "Creatures")).toBe("Creatures");
  });

  it("on blur a typed picker word turns its toggle on, spelled as the picker spells it", () => {
    const adopt = { adoptPickerWords: true };
    expect(withTokenOtherWords("Creature", "Snow legendary", adopt)).toBe("Legendary Snow Creature");
    expect(withTokenOtherWords("", "artifact", adopt)).toBe("Artifact");
    expect(tokenPickerWordsOf(withTokenOtherWords("Creature", "Snow Legendary", adopt))).toEqual(["Creature", "Legendary"]);
    expect(tokenOtherWordsOf(withTokenOtherWords("Creature", "Snow Legendary", adopt))).toBe("Snow");
  });

  it("round-trips: the field's words written back leave the supertype as it was", () => {
    for (const supertype of ["Creature", "Legendary Snow Artifact Creature", "Basic Legendary Snow Creature", "Artifact Land", "", "Legendary"]) {
      expect(withTokenOtherWords(supertype, tokenOtherWordsOf(supertype))).toBe(supertype);
      expect(withTokenOtherWords(supertype, tokenOtherWordsOf(supertype), { adoptPickerWords: true })).toBe(supertype);
    }
  });
});

describe("entering and leaving the token kind", () => {
  it("a card entering the token kind is a Creature token", () => {
    expect(supertypeEnteringToken("")).toBe("Creature");
    expect(supertypeEnteringToken("Legendary")).toBe("Legendary Creature");
    // An Artifact Creature stays one.
    expect(supertypeEnteringToken("Artifact")).toBe("Artifact Creature");
    expect(supertypeEnteringToken("Creature")).toBe("Creature");
  });

  it("the picker's type words leave with the kind; Legendary and the rest stay", () => {
    expect(supertypeLeavingToken("Creature")).toBe("");
    expect(supertypeLeavingToken("Legendary Artifact Creature")).toBe("Legendary");
    expect(supertypeLeavingToken("Snow Enchantment")).toBe("Snow");
    expect(supertypeLeavingToken("")).toBe("");
  });
});

describe("the name follows the subtypes until the user types one", () => {
  it("names a token after its subtypes", () => {
    expect(tokenNameFromSubtypes(["Rabbit", "Knight"])).toBe("Rabbit Knight");
    expect(tokenNameFromSubtypes([" Soldier ", ""])).toBe("Soldier");
    expect(tokenNameFromSubtypes([])).toBe("");
  });

  it("follows while the title is empty or still its own last name", () => {
    expect(followTokenName({ title: "", lastAuto: null, subtypes: ["Soldier"] })).toBe("Soldier");
    expect(followTokenName({ title: "Soldier", lastAuto: "Soldier", subtypes: ["Human", "Soldier"] })).toBe(
      "Human Soldier",
    );
    // Subtypes cleared: the auto name goes too.
    expect(followTokenName({ title: "Soldier", lastAuto: "Soldier", subtypes: [] })).toBe("");
    // Nothing to change.
    expect(followTokenName({ title: "Soldier", lastAuto: "Soldier", subtypes: ["Soldier"] })).toBeNull();
    expect(followTokenName({ title: "", lastAuto: null, subtypes: [] })).toBeNull();
  });

  it("stops once the user types a name of their own (TMKM #13 Voja Fenstalker)", () => {
    expect(followTokenName({ title: "Voja Fenstalker", lastAuto: "Wolf", subtypes: ["Wolf"] })).toBeNull();
    expect(followTokenName({ title: "Voja Fenstalker", lastAuto: null, subtypes: ["Wolf", "Legend"] })).toBeNull();
  });
});

describe("the frame follows the type", () => {
  it("the artifact token frame is worn by type word, not picked", () => {
    expect(isTypeWordDress("token", "m15tokenartifact")).toBe(true);
    expect(isTypeWordDress("token", "m15token")).toBe(false);
    // Only the token kind wears it that way.
    expect(isTypeWordDress("creature", "m15tokenartifact")).toBe(false);
    // Still in the token gallery — the server's frame gate and stored cards
    // on it are untouched; the pickers leave it out.
    expect(framesForKind("token", keys()).map((c) => c.template)).toContain("m15tokenartifact");
  });

  it("Artifact → the artifact token frame; no Artifact → the plain one", () => {
    expect(typeWordFrameFor("token", "m15token", "Artifact")).toBe("m15tokenartifact");
    expect(typeWordFrameFor("token", "m15token", "Artifact Creature")).toBe("m15tokenartifact");
    expect(typeWordFrameFor("token", "m15tokenartifact", "Creature")).toBe("m15token");
    expect(typeWordFrameFor("token", "m15tokenartifact", "")).toBe("m15token");
    // Enchantment stays on the plain frame until 4.51's Nyx dress.
    expect(typeWordFrameFor("token", "m15token", "Enchantment Creature")).toBe("m15token");
    // Other frames are left alone: Alpha's token, the showcase treatments.
    expect(typeWordFrameFor("token", "alphatoken", "Artifact")).toBe("alphatoken");
    expect(typeWordFrameFor("token", "fullart", "Artifact")).toBe("fullart");
    // …and every other kind.
    expect(typeWordFrameFor("creature", "m15", "Artifact")).toBe("m15");
  });

  it("typeWordFrameFits says which of the pair a card may wear", () => {
    expect(typeWordFrameFits("token", "m15tokenartifact", "Artifact")).toBe(true);
    expect(typeWordFrameFits("token", "m15token", "Artifact")).toBe(false);
    expect(typeWordFrameFits("token", "m15tokenartifact", "Creature")).toBe(false);
    expect(typeWordFrameFits("token", "fullart", "Creature")).toBe(true);
  });

  it("an AI token's random frame never dresses a Soldier as an artifact, nor a Treasure as plain", () => {
    const verified = keys(["m15token", "c"], ["m15tokenartifact", "c"]);
    for (const roll of [0, 0.99]) {
      expect(
        resolveGeneratedFrame({
          cardType: "token",
          requested: "random",
          colorIdentity: [],
          verifiedKeys: verified,
          face: { cardType: "token", supertype: "Creature", subtypes: ["Soldier"] },
          random: () => roll,
        }),
      ).toBe("m15token");
      expect(
        resolveGeneratedFrame({
          cardType: "token",
          requested: "random",
          colorIdentity: [],
          verifiedKeys: verified,
          face: { cardType: "token", supertype: "Artifact", subtypes: ["Treasure"] },
          random: () => roll,
        }),
      ).toBe("m15tokenartifact");
    }
  });

  it("asking the AI for \"M15 Token\" lands an artifact token on its artifact frame", () => {
    expect(
      resolveGeneratedFrame({
        cardType: "token",
        requested: "m15token",
        colorIdentity: [],
        verifiedKeys: keys(["m15token", "c"], ["m15tokenartifact", "c"]),
        face: { cardType: "token", supertype: "Artifact", subtypes: ["Clue"] },
      }),
    ).toBe("m15tokenartifact");
  });

  it("a kind change never falls back onto the artifact token frame", () => {
    // m15token isn't verified in white; the artifact frame is. The fallback
    // keeps the colour but never dresses a creature token as an artifact.
    const resolution = resolvePublishedFrame({
      kind: "token",
      candidates: ["m15token"],
      colorKey: "w",
      verifiedKeys: keys(["m15tokenartifact", "w"], ["fullart", "w"]),
      prefer: "frame",
    });
    expect(resolution.status).toBe("frame-switched");
    expect(resolution.status !== "unavailable" && resolution.template).toBe("fullart");
  });
});

describe("stored tokens from before the picker", () => {
  const card = (patch: Partial<Card>) =>
    ({
      id: "0e2b6f0e-0000-4000-8000-000000000001",
      slug: "stalzalfos",
      title: "Stalzalfos",
      game_system_id: "33333333-3333-4333-8333-333333333333",
      card_type: "token",
      supertype: null,
      subtypes: [],
      power: "1",
      toughness: "1",
      color_identity: [],
      tags: [],
      visibility: "public",
      frame_style: { template: "m15token" },
      back_face: null,
      ...patch,
    }) as unknown as Card;

  it("a token with a P/T and no type word reads as a Creature token (the word 0128 writes)", () => {
    expect(formSupertypeOf(card({}))).toBe("Creature");
    expect(formSupertypeOf(card({ supertype: "Legendary" }))).toBe("Legendary Creature");
    expect(defaultValuesFor(card({}), []).supertype).toBe("Creature");
    // …so its P/T inputs show and the Creature toggle is on.
    const values = defaultValuesFor(card({}), []);
    expect(statVisibility(values.card_type, [], values.supertype).pt).toBe(true);
    expect(tokenPickerWordsOf(values.supertype)).toEqual(["Creature"]);
  });

  it("a token with a P/T that says Artifact or Enchantment but not Creature reads as a creature too (the word 0128 writes)", () => {
    // Owner 2026-09-29: they keep their P/T — "Creature" added in printed order.
    expect(formSupertypeOf(card({ supertype: "Artifact", subtypes: ["Thopter"] }))).toBe("Artifact Creature");
    expect(formSupertypeOf(card({ supertype: "Enchantment" }))).toBe("Enchantment Creature");
    expect(formSupertypeOf(card({ supertype: "Legendary Artifact" }))).toBe("Legendary Artifact Creature");
    expect(formSupertypeOf(card({ supertype: "Enchantment Artifact" }))).toBe("Enchantment Artifact Creature");
    const values = defaultValuesFor(card({ supertype: "Artifact", subtypes: ["Thopter"] }), []);
    expect(values.supertype).toBe("Artifact Creature");
    expect(statVisibility(values.card_type, ["Thopter"], values.supertype).pt).toBe(true);
    expect(tokenPickerWordsOf(values.supertype)).toEqual(["Creature", "Artifact"]);
    // A Vehicle / Spacecraft prints its P/T without the word: left as stored.
    expect(formSupertypeOf(card({ supertype: "Artifact", subtypes: ["Vehicle"] }))).toBe("Artifact");
    expect(formSupertypeOf(card({ supertype: "Artifact", subtypes: [" spacecraft "] }))).toBe("Artifact");
  });

  it("leaves every other stored card's supertype as stored", () => {
    // No P/T (the "Basic" lands on the token frame, a Copy, a Treasure).
    expect(formSupertypeOf(card({ supertype: "Basic", power: null, toughness: null }))).toBe("Basic");
    expect(formSupertypeOf(card({ power: null, toughness: null }))).toBe("");
    expect(formSupertypeOf(card({ supertype: "Artifact", subtypes: ["Treasure"], power: null, toughness: null }))).toBe("Artifact");
    // A creature token already says so.
    expect(formSupertypeOf(card({ supertype: "Artifact Creature" }))).toBe("Artifact Creature");
    // Not a token.
    expect(formSupertypeOf(card({ card_type: "creature" }))).toBe("");
  });
});
