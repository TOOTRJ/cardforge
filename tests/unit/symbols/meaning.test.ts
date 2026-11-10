import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { manaValueOfCost, symbolManaValue } from "@/lib/cards/mana-value";
import { deriveColorIdentity } from "@/lib/creator/card-fields";
import { cardFormSchemaFor } from "@/lib/creator/form-schema";
import { EMPTY_BACK_FACE, EMPTY_WATERMARK, type FormValues } from "@/lib/creator/form-types";
import { deriveColorLetters, lintCardDesign, parseManaCost, type LintableCard } from "@/lib/ai/mtg-rules";
import { symbolMeaningOf, unknownSymbolCodesIn, type SymbolMeanings } from "@/lib/symbols/symbol-token";
import { unknownSymbolsMessage } from "@/lib/symbols/symbols";
import { DEFAULT_FRAME_TEMPLATE } from "@/types/card";

// ---------------------------------------------------------------------------
// What the owner's own symbols MEAN (new pips PR 3): `{*CODE}` counts the
// mana value and base colour its maker declared — read through the CARD
// OWNER's map (removed symbols included) — and a code the owner has no
// symbol for is a field error in the creator and an error in the AI's lint.
// The server's refusal: tests/unit/cards/custom-symbols-save.test.ts.
// ---------------------------------------------------------------------------

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));

const MEANINGS: SymbolMeanings = {
  FIRE: { manaValue: 3, baseColor: "R" },
  VOID: { manaValue: 0, baseColor: null },
  // A removed symbol is in the map too (it keeps drawing, so it counts).
  OLD: { manaValue: 2, baseColor: "U" },
};

describe("the map", () => {
  it("is read by code, any case; a code it lacks — or a prototype key — is no meaning", () => {
    expect(symbolMeaningOf("fire", MEANINGS)).toEqual({ manaValue: 3, baseColor: "R" });
    expect(symbolMeaningOf("NOPE", MEANINGS)).toBeNull();
    expect(symbolMeaningOf("FIRE", null)).toBeNull();
    expect(symbolMeaningOf("constructor", MEANINGS)).toBeNull();
    expect(unknownSymbolCodesIn("{*fire}{*nope}{*Nope}{*VOID}", MEANINGS)).toEqual(["NOPE"]);
    expect(unknownSymbolCodesIn("{*FIRE}", null)).toEqual(["FIRE"]);
  });

  it("the meanings come from the table's rows, a row outside its CHECKs left out", async () => {
    const { symbolMeaningsFromRows } = await import("@/lib/pips/queries");
    expect(
      symbolMeaningsFromRows([
        { code: "FIRE", mana_value: 3, base_color: "R" },
        { code: "VOID", mana_value: "0", base_color: null },
        { code: "fire", mana_value: 1, base_color: null },
        { code: "BIG", mana_value: 21, base_color: null },
        { code: "HALF", mana_value: 1.5, base_color: null },
        { code: "PINK", mana_value: 1, base_color: "P" },
      ]),
    ).toEqual({ FIRE: { manaValue: 3, baseColor: "R" }, VOID: { manaValue: 0, baseColor: null } });
  });
});

describe("mana value", () => {
  it("counts each {*CODE} at its declared value, through the owner's map", () => {
    expect(symbolManaValue("*FIRE", MEANINGS)).toBe(3);
    expect(symbolManaValue("*fire", MEANINGS)).toBe(3);
    expect(manaValueOfCost("{2}{*FIRE}", MEANINGS)).toBe(5);
    expect(manaValueOfCost("{*FIRE}{*fire}{*VOID}{*OLD}", MEANINGS)).toBe(8);
  });

  it("an unknown code, or no map, counts 0 — what every cost read before", () => {
    expect(manaValueOfCost("{2}{*NOPE}", MEANINGS)).toBe(2);
    expect(manaValueOfCost("{2}{*FIRE}")).toBe(2);
    expect(manaValueOfCost("{2}{*FIRE}", null)).toBe(2);
    // Never upper-cased into a code ("ß" → "SS").
    expect(manaValueOfCost("{*ß}", { SS: { manaValue: 5, baseColor: null } })).toBe(0);
    // The six keep their values.
    expect(manaValueOfCost("{2/W}{G/U/P}{X}", MEANINGS)).toBe(3);
  });
});

describe("colour", () => {
  it("a {*CODE} is its declared base colour; colourless, unknown or no map adds none", () => {
    expect(deriveColorIdentity("{1}{*FIRE}", MEANINGS)).toEqual(["red"]);
    expect(deriveColorIdentity("{U}{*FIRE}{*OLD}", MEANINGS)).toEqual(["blue", "red"]);
    expect(deriveColorIdentity("{*VOID}{*NOPE}", MEANINGS)).toEqual([]);
    expect(deriveColorIdentity("{*FIRE}")).toEqual([]);
  });
});

function values(over: Partial<FormValues> = {}): FormValues {
  return {
    title: "Emberbound Wyrm",
    slug: "emberbound-wyrm",
    game_system_id: "123e4567-e89b-42d3-a456-426614174000",
    cost: "{2}{R}",
    color_identity: ["red"],
    supertype: "",
    printed_types: null,
    card_type: "creature",
    subtypes_text: "Dragon",
    tags_text: "",
    rarity: "rare",
    rules_text: "Flying",
    loyalty_abilities: [],
    saga_intro: "",
    saga_chapters: [],
    flavor_text: "",
    power: "3",
    toughness: "3",
    loyalty: "",
    defense: "",
    artist_credit: "",
    art_url: "",
    art_position: { focalX: 0.5, focalY: 0.5, scale: 1 },
    frame_style: { finish: "regular", template: DEFAULT_FRAME_TEMPLATE },
    visibility: "private",
    save_as_draft: false,
    has_back_face: false,
    back_face: EMPTY_BACK_FACE,
    source_scryfall_id: "",
    set_icon_url: "",
    set_icon_code: "",
    set_code: "",
    collector_number: "",
    lang: "en",
    deck_id: "",
    watermark: EMPTY_WATERMARK,
    footer_text: "",
    ...over,
  };
}

function issues(v: FormValues, opened: string[] = []) {
  const result = cardFormSchemaFor(null, undefined, { meanings: MEANINGS, opened: new Set(opened) }).safeParse(v);
  return result.success ? [] : result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

describe("the creator's field error", () => {
  it("a code the owner has no symbol for is an error ON its field; theirs (removed too) is not", () => {
    expect(issues(values({ cost: "{1}{*FIRE}", rules_text: "{*OLD}, {T}: Add {*VOID}." }))).toEqual([]);
    expect(issues(values({ cost: "{1}{*NOPE}" }))).toEqual([{ path: "cost", message: unknownSymbolsMessage(["NOPE"]) }]);
    expect(issues(values({ rules_text: "{*nope}: Draw. {*ZAP} {*FIRE}" }))).toEqual([
      { path: "rules_text", message: unknownSymbolsMessage(["NOPE", "ZAP"]) },
    ]);
  });

  it("on a row and on the second face, at their own paths", () => {
    const walker = values({
      card_type: "planeswalker",
      frame_style: { finish: "regular", template: "m15pw" },
      power: "",
      toughness: "",
      loyalty: "3",
      loyalty_abilities: [
        { cost: "+1", text: "Draw." },
        { cost: "-2", text: "Add {*NOPE}." },
      ],
    } as Partial<FormValues>);
    expect(issues(walker).map((issue) => issue.path)).toContain("loyalty_abilities.1.text");
    const back = values({
      has_back_face: true,
      back_face: { ...EMPTY_BACK_FACE, title: "Back", cost: "{*NOPE}", rules_text: "Flying" },
    });
    expect(issues(back).map((issue) => issue.path)).toContain("back_face.cost");
  });

  it("never on a field the creator doesn't show on this frame — Save would wait with no message", () => {
    // A cost on a frame that hides it (a land's): never drawn.
    expect(issues(values({ card_type: "land", cost: "{1}{*NOPE}", frame_style: { finish: "regular", template: "m15land" } }))).toEqual([]);
    // A walker's / saga's rules text with every row removed: its panel is the
    // rows, and the save sends no rules text then.
    const walker = values({
      card_type: "planeswalker",
      frame_style: { finish: "regular", template: "m15pw" },
      power: "",
      toughness: "",
      loyalty: "3",
      rules_text: "+1: Add {*NOPE}.",
      loyalty_abilities: [],
    } as Partial<FormValues>);
    expect(issues(walker).filter((issue) => issue.message.includes("NOPE"))).toEqual([]);
    const saga = values({
      card_type: "enchantment",
      subtypes_text: "Saga",
      frame_style: { finish: "regular", template: "saga" },
      power: "",
      toughness: "",
      rules_text: "I — Add {*NOPE}.",
      saga_chapters: [],
    } as Partial<FormValues>);
    expect(issues(saga).filter((issue) => issue.message.includes("NOPE"))).toEqual([]);
  });

  it("is wired: the create and edit pages read the owner's meanings, the form hands them to its schema and the cost panel", () => {
    const form = readFileSync(join(process.cwd(), "components/creator/card-creator-form.tsx"), "utf8");
    expect(form).toMatch(/cardFormSchemaFor\(\s*[\s\S]*?formBackBody,\s*formSymbols,\s*\)/);
    expect(form).toContain("symbolMeanings={symbolMeanings}");
    for (const page of ["app/(app)/create/page.tsx", "app/(app)/card/[username]/edit/page.tsx"]) {
      expect(readFileSync(join(process.cwd(), page), "utf8"), page).toContain("symbolMeanings={await getSymbolMeanings(user.id)}");
    }
  });

  it("an edit is never asked about a code its stored card already named", () => {
    expect(issues(values({ rules_text: "{*GONE}: Draw a card." }), ["GONE"])).toEqual([]);
    expect(issues(values({ rules_text: "{*GONE}{*NEW}" }), ["GONE"])).toEqual([
      { path: "rules_text", message: unknownSymbolsMessage(["NEW"]) },
    ]);
  });

  it("with no map (a guest, a page that read none) nothing is checked here", () => {
    expect(cardFormSchemaFor().safeParse(values({ cost: "{*NOPE}" })).success).toBe(true);
  });

  it("says it in words", () => {
    expect(unknownSymbolsMessage(["NOPE"])).toBe(
      "{*NOPE} isn't one of your mana symbols. Make it in New mana symbols first, or take it out.",
    );
    expect(unknownSymbolsMessage(["A", "B", "C"])).toBe(
      "{*A}, {*B} and {*C} aren't your mana symbols. Make them in New mana symbols first, or take them out.",
    );
  });
});

describe("the AI's lint", () => {
  const card = (over: Partial<LintableCard> = {}): LintableCard => ({
    title: "Cinder Imp",
    cost: "{1}{R}",
    card_type: "creature",
    supertype: null,
    subtypes: ["Imp"],
    color_identity: ["red"],
    rules_text: "Flying",
    power: "2",
    toughness: "1",
    loyalty: null,
    defense: null,
    ...over,
  });
  const errorFields = (c: LintableCard, meanings?: SymbolMeanings) =>
    lintCardDesign(c, { symbolMeanings: meanings }).errors.map((issue) => issue.field);

  it("refuses any {*CODE} it wasn't given — in the cost and in the rules text", () => {
    expect(errorFields(card({ cost: "{1}{*FIRE}" }))).toEqual(["cost"]);
    expect(errorFields(card({ rules_text: "{*FIRE}: Flying." }))).toEqual(["rules_text"]);
    const [issue] = lintCardDesign(card({ rules_text: "{*NOPE}: Flying." }), { symbolMeanings: MEANINGS }).errors;
    expect(issue.message).toContain("{*NOPE} isn't one of the card owner's mana symbols");
  });

  it("accepts the owner's codes, counting their value and colour", () => {
    expect(parseManaCost("{1}{*FIRE}", MEANINGS)).toEqual({ symbols: ["1", "*FIRE"], manaValue: 4, colorLetters: ["R"] });
    expect(parseManaCost("{1}{*FIRE}")).toBeNull();
    expect(deriveColorLetters("{1}", "{*FIRE}, {T}: Add {*VOID}.", MEANINGS)).toEqual(["R"]);
    expect(errorFields(card({ cost: "{*FIRE}", rules_text: "{*VOID}: Flying." }), MEANINGS)).toEqual([]);
    // Its colour is held to the card's like a printed pip's: a red symbol on
    // a blue card is the colour drift error.
    expect(errorFields(card({ cost: "{*FIRE}", color_identity: ["blue"] }), MEANINGS)).toContain("color_identity");
  });
});
