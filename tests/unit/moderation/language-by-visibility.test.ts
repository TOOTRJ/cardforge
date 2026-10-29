import { describe, expect, it } from "vitest";
import { languageForcesPrivate, languageForcesPrivateByVisibility, type ProfanityScanInput } from "@/lib/moderation/profanity";

// ---------------------------------------------------------------------------
// languageForcesPrivateByVisibility (perf, 2026-10-29): the creator's
// Publish step asks the strong-language rule about a public AND an unlisted
// save. It used to call languageForcesPrivate twice — two scans of the same
// text; now it reads the text once. Each answer must be exactly what its
// own languageForcesPrivate call says, for every kind of save: new, an edit
// of a card in view or not, grandfathered or not, wider audience or not.
// The words are ROT13'd: the repo is public.
// ---------------------------------------------------------------------------

const rot13 = (text: string) => text.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));
const S = rot13("fuvg");
const F = rot13("shpx");

const CARDS: ProfanityScanInput[] = [
  {},
  { rules_text: "Flying" },
  { rules_text: S },
  { rules_text: `Draw a card, ${F}.` },
  { flavor_text: `A ${S} day.` },
  { flavor_text: `A ${S} day, again.` },
  { flavor_text: `A ${F} day.` },
  { rules_text: S, flavor_text: S },
  { title: `${S} Lord`, tags: ["dragons", S] },
  { title: `${S.toUpperCase()} LORD`, tags_text: `dragons, ${S}` },
  { subtypes_text: `Goblin ${S}`, tags_text: `dragons, ${S}` },
  { subtypes: ["Goblin", S], tags: ["dragons", S] },
  { rules_text: `+1: Draw, ${S}.\n−2: Tap it.` },
  {
    rules_text: `+1: Draw, ${S}.\n−2: Tap it.`,
    face_content: { v: 1, loyalty: { abilities: [{ cost: "+1", text: `Draw, ${S}.` }, { cost: "-2", text: "Tap it." }] } },
  },
  { back_face: { title: S, rules_text: "Flying" } },
  { back_face: { title: "Cockatrice", rules_text: S } },
  { footer_text: S, power: S },
  { title: "Hell's Caretaker", flavor_text: "Damn." },
];

const VISIBILITIES: Array<string | null | undefined> = ["public", "unlisted", "private", null, undefined, "secret", "constructor"];

describe("languageForcesPrivateByVisibility — one scan, the same answers", () => {
  it("equals languageForcesPrivate at public and at unlisted, for every save", () => {
    let compared = 0;
    for (const saved of CARDS) {
      const stores = [null, undefined, ...CARDS.flatMap((card) => VISIBILITIES.map((visibility) => ({ card, visibility })))];
      for (const stored of stores) {
        const both = languageForcesPrivateByVisibility({ saved, stored });
        expect(both, JSON.stringify({ saved, stored })).toEqual({
          public: languageForcesPrivate({ saved, visibility: "public", stored }),
          unlisted: languageForcesPrivate({ saved, visibility: "unlisted", stored }),
        });
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(2000);
  });

  it("names the fields as the rule does, and keeps a grandfathered edit open", () => {
    expect(languageForcesPrivateByVisibility({ saved: { rules_text: S } })).toEqual({ public: ["rules_text"], unlisted: ["rules_text"] });
    // An unlisted card that keeps its text: Unlisted stays open, Public widens it.
    expect(
      languageForcesPrivateByVisibility({ saved: { rules_text: S }, stored: { card: { rules_text: S }, visibility: "unlisted" } }),
    ).toEqual({ public: ["rules_text"], unlisted: [] });
    expect(languageForcesPrivateByVisibility({ saved: { rules_text: "Flying" } })).toEqual({ public: [], unlisted: [] });
  });

  it("hands back two arrays, never one shared", () => {
    const both = languageForcesPrivateByVisibility({ saved: { rules_text: S } });
    expect(both.public).not.toBe(both.unlisted);
  });
});
