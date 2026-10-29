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
