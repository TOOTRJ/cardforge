import { describe, expect, it } from "vitest";
import { defaultValuesFor } from "@/lib/creator/card-fields";
import { EMPTY_BACK_FACE, type FormValues } from "@/lib/creator/form-types";
import {
  creatorLanguageFields,
  NO_STRONG_LANGUAGE,
  strongLanguageChoices,
  type CreatorLanguageContext,
} from "@/lib/creator/strong-language";
import type { Card } from "@/types/card";

// ---------------------------------------------------------------------------
// The creator's Publish-step choices (perf, 2026-10-29): strongLanguageChoices
// reads the form's text ONCE for both choices, and must say exactly what
// creatorLanguageFields says for "public" and for "unlisted" — the rule the
// save itself runs. NO_STRONG_LANGUAGE is what the form hands the panel off
// the Publish step. The words are ROT13'd: the repo is public.
// ---------------------------------------------------------------------------

const rot13 = (text: string) => text.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));
const S = rot13("fuvg");

const base = defaultValuesFor(undefined, []);
const form = (patch: Partial<FormValues>): FormValues => ({ ...base, ...patch });

const VALUES: FormValues[] = [
  form({}),
  form({ title: "Emberbound Wyrm", rules_text: "Flying" }),
  form({ title: `${S} Wyrm` }),
  form({ tags_text: `dragons, ${S}` }),
  form({ subtypes_text: `Goblin ${S}` }),
  form({ flavor_text: `A ${S} day.` }),
  form({ footer_text: S }),
  form({ loyalty_abilities: [{ cost: "+1", text: S }] as FormValues["loyalty_abilities"] }),
  form({ has_back_face: true, back_face: { ...EMPTY_BACK_FACE, title: S } }),
  form({ has_back_face: false, back_face: { ...EMPTY_BACK_FACE, title: S } }),
  form({ title: `${S} Wyrm`, has_back_face: true, back_face: { ...EMPTY_BACK_FACE, rules_text: S } }),
];

const storedCard = (patch: Partial<Card>) => ({ title: "Emberbound Wyrm", rules_text: "Flying", ...patch }) as Card;
const STORED: Array<CreatorLanguageContext["stored"]> = [
  null,
  ...(["public", "unlisted", "private"] as const).flatMap((visibility) => [
    storedCard({ visibility }),
    storedCard({ visibility, title: `${S} Wyrm` }),
    storedCard({ visibility, flavor_text: `A ${S} day.` }),
    storedCard({ visibility, tags: ["dragons", S] }),
  ]),
];

describe("strongLanguageChoices", () => {
  it("says what creatorLanguageFields says for each choice, for every form and edit", () => {
    let compared = 0;
    for (const values of VALUES) {
      for (const stored of STORED) {
        for (const footerStored of [true, false]) {
          const context: CreatorLanguageContext = { stored, footerStored };
          expect(strongLanguageChoices(values, context)).toEqual({
            public: creatorLanguageFields(values, "public", context),
            unlisted: creatorLanguageFields(values, "unlisted", context),
          });
          compared += 1;
        }
      }
    }
    expect(compared).toBe(VALUES.length * STORED.length * 2);
  });

  it("rules out both choices for a new card with a word in its name", () => {
    expect(strongLanguageChoices(form({ title: `${S} Wyrm` }), { stored: null, footerStored: false })).toEqual({
      public: ["title"],
      unlisted: ["title"],
    });
  });
});

describe("NO_STRONG_LANGUAGE", () => {
  it("rules nothing out, and is one frozen value", () => {
    expect(NO_STRONG_LANGUAGE).toEqual({ public: [], unlisted: [] });
    expect(Object.isFrozen(NO_STRONG_LANGUAGE)).toBe(true);
    expect(Object.isFrozen(NO_STRONG_LANGUAGE.public)).toBe(true);
    expect(Object.isFrozen(NO_STRONG_LANGUAGE.unlisted)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The text the save WRITES (the 2026-11 save audit): for a walker or a saga
// the form's `rules_text` is a hidden copy the row editors never update — an
// edit's stored text, the text before a kind switch — and the check read it
// beside the rows. A word taken out of a row stayed in it: the cleaned card
// kept Public and Unlisted unavailable and saved private. The saga
// creature's "Creature abilities" box, which the save writes after the
// chapters, was read nowhere. Now the check reads submittedRulesOf's answer
// — the rules text and rows the server judges.
// ---------------------------------------------------------------------------

describe("walkers and sagas: the rows as the save writes them", () => {
  const walkerCard = (rules: string, visibility: Card["visibility"] = "private") =>
    ({
      ...storedCard({ visibility }),
      title: "Tamsin, Tide-Reader",
      card_type: "planeswalker",
      supertype: "Legendary",
      subtypes: ["Tamsin"],
      color_identity: ["blue"],
      rules_text: rules,
      face_content: null,
      frame_style: { template: "m15pw", finish: "regular" },
      loyalty: "4",
    }) as unknown as Card;
  const editContext = (card: Card): CreatorLanguageContext => ({
    stored: card,
    footerStored: false,
    rules: {
      opened: defaultValuesFor(card, []),
      storedFaceContent: card.face_content ?? null,
      storedRulesText: card.rules_text ?? null,
    },
  });

  it("an edit that takes the word out of a walker's row is clean — the hidden stored text no longer counts", () => {
    const card = walkerCard(`+1: Draw a ${S} card.\n−2: Tap target creature.`);
    const values = defaultValuesFor(card, []);
    // The form opened on the stored text, the word in its first row.
    expect(values.rules_text).toContain(S);
    expect(creatorLanguageFields(values, "public", editContext(card))).toEqual(["rules_text"]);
    const cleaned: FormValues = {
      ...values,
      loyalty_abilities: values.loyalty_abilities.map((row, i) => (i === 0 ? { ...row, text: "Draw a card." } : row)),
    };
    // The hidden copy still holds it…
    expect(cleaned.rules_text).toContain(S);
    // …and the save writes the rows: clean, both choices open.
    expect(creatorLanguageFields(cleaned, "public", editContext(card))).toEqual([]);
    expect(strongLanguageChoices(cleaned, editContext(card))).toEqual({ public: [], unlisted: [] });
  });

  it("a word typed into a row is read (the rows are the text)", () => {
    const card = walkerCard("+1: Draw a card.\n−2: Tap target creature.", "public");
    const values = defaultValuesFor(card, []);
    const dirty: FormValues = {
      ...values,
      loyalty_abilities: values.loyalty_abilities.map((row, i) => (i === 1 ? { ...row, text: `Tap target ${S}.` } : row)),
    };
    expect(creatorLanguageFields(dirty, "public", editContext(card))).toEqual(["rules_text"]);
  });

  it("a saga's chapter the same", () => {
    const card = {
      ...walkerCard(`I — Draw a ${S} card.\nII — Scry 2.`),
      title: "The Long Night",
      card_type: "enchantment",
      supertype: null,
      subtypes: ["Saga"],
      loyalty: null,
      frame_style: { template: "saga", finish: "regular" },
    } as unknown as Card;
    const values = defaultValuesFor(card, []);
    expect(values.saga_chapters.length).toBeGreaterThan(0);
    expect(creatorLanguageFields(values, "public", editContext(card))).toEqual(["rules_text"]);
    const cleaned: FormValues = {
      ...values,
      saga_chapters: values.saga_chapters.map((row, i) => (i === 0 ? { ...row, text: "Draw a card." } : row)),
    };
    expect(cleaned.rules_text).toContain(S);
    expect(creatorLanguageFields(cleaned, "public", editContext(card))).toEqual([]);
  });

  it("a NEW walker whose hidden text came from the kind it left: its rows decide", () => {
    const values = form({
      card_type: "planeswalker",
      frame_style: { ...base.frame_style, template: "m15pw" },
      rules_text: `A ${S} creature's text, from before the kind switch.`,
      loyalty_abilities: [{ cost: "+1", text: "Draw a card." }] as FormValues["loyalty_abilities"],
    });
    expect(creatorLanguageFields(values, "public", { stored: null, footerStored: false })).toEqual([]);
  });

  it("the saga creature's \"Creature abilities\" box is read: the save writes it after the chapters", () => {
    const values = form({
      title: "Summon: Ifrit",
      card_type: "enchantment",
      supertype: "Creature",
      subtypes_text: "Saga",
      frame_style: { ...base.frame_style, template: "sagacreature" },
      saga_chapters: [{ numerals: [1], text: "Deal 2 damage." }] as unknown as FormValues["saga_chapters"],
      saga_creature_text: `Haste. This ${S} is hot.`,
    });
    const fresh = { stored: null, footerStored: false };
    expect(creatorLanguageFields(values, "public", fresh)).toEqual(["rules_text"]);
    expect(strongLanguageChoices(values, fresh)).toEqual({ public: ["rules_text"], unlisted: ["rules_text"] });
    expect(creatorLanguageFields({ ...values, saga_creature_text: "Haste." }, "public", fresh)).toEqual([]);
  });
});
