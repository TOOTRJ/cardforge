import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  containsProfanity,
  languageForcesPrivate,
  profaneFieldList,
  profaneFields,
  strongLanguageNote,
  strongLanguageSavedMessage,
} from "@/lib/moderation/profanity";
import { CR_KEYWORD_NAMES, KEYWORD_REMINDERS } from "@/lib/cards/keyword-reminders";

// ---------------------------------------------------------------------------
// The ONE strong-language detector (owner policy 2026-10-28): strong
// profanity and slurs make a card private; mild words real cards print —
// and every real card name and Oracle text in the repo's Scryfall fixtures —
// never do. The repo is public: the words under test are ROT13'd here as
// they are in the module, and decoded at run time.
// ---------------------------------------------------------------------------

const rot13 = (text: string) =>
  text.replace(/[a-z]/gi, (c) => {
    const base = c <= "Z" ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });

// One form of each group the list holds (strong words and slurs).
const STRONG = ["shpx", "fuvg", "phag", "pbpxfhpxre", "nffubyr", "qvpxurnq", "ovgpu", "gjng", "jnaxre", "juber", "fyhg", "avttre", "snttbg", "xvxr", "ergneq"].map(rot13);
const F = rot13("shpx");
const S = rot13("fuvg");

describe("containsProfanity — strong words", () => {
  it.each(STRONG)("finds a listed word on its own (#%#)", (word) => {
    expect(containsProfanity(word)).toBe(true);
    expect(containsProfanity(`What the ${word} is this?`)).toBe(true);
    expect(containsProfanity(`${word}.`)).toBe(true);
  });

  it("finds a word in any case, with accents and in full-width letters", () => {
    expect(containsProfanity(S.toUpperCase())).toBe(true);
    expect(containsProfanity(`${S[0].toUpperCase()}${S.slice(1)}`)).toBe(true);
    expect(containsProfanity(S.replace("i", "í"))).toBe(true);
    const fullWidth = [...S].map((c) => String.fromCharCode(c.charCodeAt(0) - 97 + 0xff41)).join("");
    expect(containsProfanity(fullWidth)).toBe(true);
  });

  it("finds its stems and compounds", () => {
    for (const form of ["shpxvat", "shpxrq", "zbgureshpxre", "ohyyfuvg", "fuvggl", "nffubyrf", "avttnf"].map(rot13)) {
      expect(containsProfanity(form)).toBe(true);
    }
  });

  it("finds leetspeak, a masked vowel and repeated letters", () => {
    expect(containsProfanity(S.replace("s", "$").replace("i", "1"))).toBe(true);
    expect(containsProfanity(S.replace("s", "5").replace("t", "7"))).toBe(true);
    expect(containsProfanity(F.replace("u", "*"))).toBe(true);
    expect(containsProfanity(F.replace("u", "v"))).toBe(true);
    expect(containsProfanity(F.replace("u", "uuuuu"))).toBe(true);
    expect(containsProfanity(S.replace("i", "iii"))).toBe(true);
    expect(containsProfanity(rot13("ovgpu").replace("i", "!"))).toBe(true);
  });

  it("finds a word spelled out with spaces, dots or dashes", () => {
    expect(containsProfanity([...F].join(" "))).toBe(true);
    expect(containsProfanity([...F].join("."))).toBe(true);
    expect(containsProfanity([...S].join("-"))).toBe(true);
    expect(containsProfanity(`Oh ${[...F].join(" ")} it`)).toBe(true);
  });

  it("finds a word split by an invisible character", () => {
    expect(containsProfanity(`${S.slice(0, 2)}​${S.slice(2)}`)).toBe(true);
    expect(containsProfanity(`${F.slice(0, 2)}­${F.slice(2)}`)).toBe(true);
  });

  it("finds the infix stem inside a longer word", () => {
    expect(containsProfanity(`un${F}withable`)).toBe(true);
  });

  it("finds a prefix stem whatever follows it (no English word starts with one)", () => {
    for (const form of ["ovgpuvarff", "juberqbz", "phagvfu", "fyhggvfu", "nffubyrel"].map(rot13)) {
      expect(containsProfanity(form), form).toBe(true);
    }
  });

  it("folds Cyrillic and Greek look-alike letters", () => {
    expect(containsProfanity(S.replace("i", "і"))).toBe(true); // Cyrillic і
    expect(containsProfanity(F.replace("u", "υ"))).toBe(true); // Greek υ
    expect(containsProfanity(rot13("pbbaf").replace(/o/g, "о"))).toBe(true); // Cyrillic о
    expect(containsProfanity(rot13("ovgpu").replace("c", "с"))).toBe(true); // Cyrillic с
  });

  it("finds a word with two letters masked, never a mask with too few real letters", () => {
    expect(containsProfanity(`${F[0]}**${F[3]}`)).toBe(true);
    expect(containsProfanity(`${S[0]}**${S[3]}`)).toBe(true);
    expect(containsProfanity(`**${S}**`)).toBe(true);
    expect(containsProfanity(`${F[0]}***`)).toBe(false);
    expect(containsProfanity("****")).toBe(false);
    expect(containsProfanity("*/*")).toBe(false);
    expect(containsProfanity("1+*")).toBe(false);
  });
});

describe("containsProfanity — no false positives", () => {
  it("leaves mild words alone (allowed, never forced private)", () => {
    for (const text of ["Damn it all.", "Go to hell.", "Hell's Caretaker", "Damnation", "You bastard!", "What an ass.", "Crap.", "Bloody hell", "Piss off"]) {
      expect(containsProfanity(text)).toBe(false);
    }
  });

  it("leaves violence alone", () => {
    expect(containsProfanity("Destroy target creature. Its controller loses 3 life. Kill them all, slaughter, murder.")).toBe(false);
  });

  it("is not fooled by the Scunthorpe problem", () => {
    for (const text of [
      "Scunthorpe",
      "Cockatrice",
      "Assassin's Strike",
      "Assassinate",
      "class",
      "Classic",
      "Dickens",
      "Hellhole Rats",
      "Hellhole Flailer",
      "Raccoon Rallier",
      "Cocktail",
      "Peacock",
      "Hitchcock",
      "Middlesex",
      "Shiitake",
      "Mishit",
      "Snigger",
      "Sniggering",
      "Niger",
      "Pakistan",
      "Spice",
      "Spiculum",
      "Retardant",
      "Bitterblossom",
      "Twitch",
      "Wankel",
      "Cumulative upkeep {2}",
      "Circumstance",
      "Analyze",
      "Grasshopper",
      "Fagin",
      "Shittim",
      "Bass",
      "Assess",
      "Embarrass",
      "Hancock",
      "Glasscock",
      "Scrap Trawler",
      "Kikimora",
      "Gooky",
    ]) {
      expect(containsProfanity(text), text).toBe(false);
    }
  });

  it("leaves rules text with numbers and symbols alone", () => {
    expect(containsProfanity("{T}: Add {C}{C}. +1/+1 counters. Activate only as a sorcery. 5/5 Demon")).toBe(false);
    expect(containsProfanity("−3: Deal 4 damage. 0: Untap. X: Draw X cards.")).toBe(false);
    expect(containsProfanity("")).toBe(false);
    expect(containsProfanity(null)).toBe(false);
  });

  it("leaves every keyword and its reminder text alone", () => {
    const texts = [...CR_KEYWORD_NAMES, ...KEYWORD_REMINDERS.flatMap((k) => [k.name, k.text, k.reminder])];
    expect(texts.filter((text) => containsProfanity(text))).toEqual([]);
  });

  it("never reads a number as a word (no digit stands for g; a match needs a real letter)", () => {
    for (const text of ["600k bounty", "900K gold", "Pay 6000 life", "5007", "0000", "1337"]) {
      expect(containsProfanity(text), text).toBe(false);
    }
  });

  // KNOWN false positives, accepted as the list's cost (owner 2026-10-28):
  // innocent phrases that spell a listed word on its own. Rare in card
  // text; a card that trips one saves private and its maker is told which
  // field. Pinned so a change to them is deliberate.
  it("known, accepted false positives", () => {
    for (const text of ["Spic and span", "Coon Creek", "pussy willow", "It retards the spread."]) {
      expect(containsProfanity(text), text).toBe(true);
    }
  });

  it("leaves a spaced-out list of single letters alone", () => {
    expect(containsProfanity("Choose one: a, b, or c. W U B R G")).toBe(false);
  });

  // Every card name, type line, Oracle text, flavour text, flavour name and
  // artist in the repo's Scryfall fixtures (2,700+ printings) — none trips.
  it("passes every real card in the Scryfall fixtures", () => {
    const texts = realCardTexts();
    expect(texts.size).toBeGreaterThan(2000);
    const flagged = [...texts].filter((text) => containsProfanity(text));
    expect(flagged).toEqual([]);
  });
});

describe("profaneFields — every text field of a card", () => {
  it("is empty for a clean card", () => {
    expect(
      profaneFields({
        title: "Hell's Caretaker",
        supertype: "Legendary",
        subtypes: ["Horror"],
        rules_text: "Damnation awaits.",
        flavor_text: "Damn.",
        tags: ["dragons"],
        back_face: { title: "Cockatrice", rules_text: "Assassinate." },
      }),
    ).toEqual([]);
  });

  it("names each field that holds strong language, front and back", () => {
    expect(
      profaneFields({
        title: `${S} Lord`,
        nickname: S,
        supertype: S,
        subtypes: ["Goblin", S],
        rules_text: `Draw a card, ${F}.`,
        flavor_text: S,
        artist_credit: S,
        footer_text: S,
        tags: ["dragons", S],
        back_face: {
          title: S,
          printed_types: S,
          rules_text: S,
          flavor_text: S,
          artist_credit: S,
        },
      }),
    ).toEqual([
      "title",
      "nickname",
      "type_line",
      "rules_text",
      "flavor_text",
      "artist_credit",
      "footer_text",
      "tags",
      "back_face.title",
      "back_face.type_line",
      "back_face.rules_text",
      "back_face.flavor_text",
      "back_face.artist_credit",
    ]);
  });

  it("reads a walker's, saga's and station card's rows as its rules text", () => {
    expect(profaneFields({ face_content: { v: 1, loyalty: { abilities: [{ cost: "+1", text: S }] } } })).toEqual(["rules_text"]);
    expect(profaneFields({ face_content: { v: 1, saga: { intro: S, chapters: [] } } })).toEqual(["rules_text"]);
    expect(profaneFields({ face_content: { v: 1, saga: { chapters: [{ numerals: [1], text: S }] } } })).toEqual(["rules_text"]);
    expect(profaneFields({ face_content: { v: 1, station: { tiers: [{ threshold: 3, text: S }] } } })).toEqual(["rules_text"]);
  });

  it("reads the printed stats and the collector line, both faces", () => {
    for (const key of ["power", "toughness", "loyalty", "defense", "set_code", "collector_number"]) {
      expect(profaneFields({ [key]: S }), key).toEqual(["stats"]);
    }
    expect(profaneFields({ cost: `{2}{${S}}` })).toEqual(["stats"]);
    expect(profaneFields({ back_face: { power: S } })).toEqual(["back_face.stats"]);
    expect(profaneFields({ back_face: { cost: `{${F}}` } })).toEqual(["back_face.stats"]);
    // Real stats and costs are no text: the symbols (snow, tap, hybrid,
    // Phyrexian, X…), stars, the collector line.
    expect(
      profaneFields({
        cost: "{X}{2}{W/U}{B/P}{2/G}{S}{C}{T}{Q}{E}{HW}{½}{∞}",
        power: "*",
        toughness: "1+*",
        loyalty: "X",
        defense: "5",
        set_code: "DMU",
        collector_number: "107/281",
        back_face: { cost: "{W/U/P}", power: "*" },
      }),
    ).toEqual([]);
  });

  it("reads the creator's form values too", () => {
    expect(profaneFields({ subtypes_text: `Goblin ${S}` })).toEqual(["type_line"]);
    expect(profaneFields({ tags_text: `dragons, ${S}` })).toEqual(["tags"]);
    expect(profaneFields({ loyalty_abilities: [{ cost: "+1", text: S }] })).toEqual(["rules_text"]);
    expect(profaneFields({ saga_intro: S })).toEqual(["rules_text"]);
    expect(profaneFields({ saga_chapters: [{ numerals: [1], text: S }] })).toEqual(["rules_text"]);
    expect(profaneFields({ back_face: { subtypes_text: S } })).toEqual(["back_face.type_line"]);
  });

  it("ignores what holds no text and what a back face is not", () => {
    expect(profaneFields(null)).toEqual([]);
    expect(profaneFields({ title: 3, rules_text: null, back_face: [S], tags: [null] })).toEqual([]);
    // A back face's art / frame keys are no card text.
    expect(profaneFields({ back_face: { art_url: `https://x.test/${S}.png` } })).toEqual([]);
  });
});

describe("languageForcesPrivate — the rule every save applies", () => {
  const rough = { rules_text: S };
  const clean = { rules_text: "Flying" };

  it("forces a public or unlisted save of a card with strong language, never a private one", () => {
    expect(languageForcesPrivate({ saved: rough, visibility: "public" })).toEqual(["rules_text"]);
    expect(languageForcesPrivate({ saved: rough, visibility: "unlisted" })).toEqual(["rules_text"]);
    expect(languageForcesPrivate({ saved: rough, visibility: "private" })).toEqual([]);
    expect(languageForcesPrivate({ saved: clean, visibility: "public" })).toEqual([]);
  });

  it("an edit adding a word, or publishing a draft that holds one, is forced", () => {
    expect(languageForcesPrivate({ saved: rough, visibility: "public", stored: { card: clean, visibility: "public" } })).toEqual(["rules_text"]);
    expect(languageForcesPrivate({ saved: rough, visibility: "public", stored: { card: rough, visibility: "private" } })).toEqual(["rules_text"]);
    expect(languageForcesPrivate({ saved: rough, visibility: "public", stored: { card: rough, visibility: "unlisted" } })).toEqual(["rules_text"]);
    expect(
      languageForcesPrivate({ saved: { rules_text: S, flavor_text: S }, visibility: "public", stored: { card: rough, visibility: "public" } }),
    ).toEqual(["rules_text", "flavor_text"]);
  });

  it("a flagged field is grandfathered only while its text is unchanged — any edit to it forces", () => {
    const stored = { card: { flavor_text: `A ${S} day.` }, visibility: "public" };
    expect(languageForcesPrivate({ saved: { flavor_text: `A ${S} day.` }, visibility: "public", stored })).toEqual([]);
    expect(languageForcesPrivate({ saved: { flavor_text: `A ${S} day, again.` }, visibility: "public", stored })).toEqual([
      "flavor_text",
    ]);
    expect(languageForcesPrivate({ saved: { flavor_text: `${S}.` }, visibility: "public", stored })).toEqual(["flavor_text"]);
    expect(languageForcesPrivate({ saved: { flavor_text: `A ${F} day.` }, visibility: "public", stored })).toEqual(["flavor_text"]);
  });

  it("reads a field resent as stored as unchanged: typography, a dual-written walker, tags as typed", () => {
    // A walker stored as plain text gains its rows beside it on an edit.
    const walker = { rules_text: `+1: Draw, ${S}.\n−2: Tap it.` };
    expect(
      languageForcesPrivate({
        saved: {
          ...walker,
          face_content: { v: 1, loyalty: { abilities: [{ cost: "+1", text: `Draw, ${S}.` }, { cost: "-2", text: "Tap it." }] } },
        },
        visibility: "public",
        stored: { card: walker, visibility: "public" },
      }),
    ).toEqual([]);
    // The form's typed tags against the stored list; its subtypes text against the array.
    expect(
      languageForcesPrivate({
        saved: { tags_text: `dragons, ${S}`, subtypes_text: `Goblin ${S}` },
        visibility: "public",
        stored: { card: { tags: ["dragons", S], subtypes: ["Goblin", S] }, visibility: "public" },
      }),
    ).toEqual([]);
    // Case and accents are no change.
    expect(
      languageForcesPrivate({
        saved: { title: `${S.toUpperCase()} Lord` },
        visibility: "public",
        stored: { card: { title: `${S} lord` }, visibility: "public" },
      }),
    ).toEqual([]);
  });

  it("an edit of a card already in view that adds none and widens nothing is left alone", () => {
    expect(languageForcesPrivate({ saved: rough, visibility: "public", stored: { card: rough, visibility: "public" } })).toEqual([]);
    expect(languageForcesPrivate({ saved: rough, visibility: "unlisted", stored: { card: rough, visibility: "public" } })).toEqual([]);
    expect(languageForcesPrivate({ saved: rough, visibility: "unlisted", stored: { card: rough, visibility: "unlisted" } })).toEqual([]);
  });
});

describe("the words", () => {
  it("lists the fields in plain words", () => {
    expect(profaneFieldList(["rules_text"])).toBe("rules text");
    expect(profaneFieldList(["title", "rules_text"])).toBe("name and rules text");
    expect(profaneFieldList(["title", "tags", "back_face.flavor_text"])).toBe("name, tags and second face's flavor text");
  });

  it("says what happens and how to undo it", () => {
    expect(strongLanguageNote(["rules_text"])).toBe(
      "This card's rules text includes strong language, so it will be saved as private. Remove it to publish.",
    );
    expect(strongLanguageSavedMessage("Grim", ["title"])).toBe(
      "Saved “Grim” as private — its name includes strong language. Remove it to publish.",
    );
  });
});

/** The text of every printing in the repo's Scryfall fixtures. */
function realCardTexts(): Set<string> {
  const roots = ["tests/unit/scryfall/fixtures", "tests/unit/creator/fixtures"];
  const texts = new Set<string>();
  const walk = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    for (const key of ["name", "oracle_text", "flavor_text", "type_line", "flavor_name", "artist", "printed_name", "printed_text"]) {
      if (typeof record[key] === "string" && ("oracle_text" in record || "type_line" in record)) texts.add(record[key] as string);
    }
    Object.values(record).forEach(walk);
  };
  for (const root of roots) {
    for (const file of readdirSync(root)) {
      const path = join(root, file);
      if (!file.endsWith(".json") || !statSync(path).isFile()) continue;
      walk(JSON.parse(readFileSync(path, "utf8")));
    }
  }
  return texts;
}
