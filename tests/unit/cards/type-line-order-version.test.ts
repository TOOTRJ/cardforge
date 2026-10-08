import { describe, expect, it } from "vitest";
import { buildTypeLine, printsPowerToughness } from "@/lib/cards/card-display";
import * as layoutVersion from "@/lib/cards/layout-version";
import {
  CARD_LAYOUT_VERSION,
  RESERVED_SYMBOLS_PRINT_VERSION,
  TYPE_LINE_ORDER_LAYOUT_VERSION,
  VERIFICATION_NEUTRAL_VERSIONS,
  VERIFICATION_SCOPED_VERSIONS,
  VERSION_ROLLOUT,
  VERSION_SCOPES,
  classifyForSweep,
  hasNewerLook,
  isRenderStale,
  latestOptInVersion,
  rolloutPolicy,
  v50FaceChanged,
} from "@/lib/cards/layout-version";
import { CARD_TYPE_VALUES, FRAME_TEMPLATE_VALUES, type CardType } from "@/types/card";
import { UNTOUCHED_SINCE_V22 } from "../../stubs/layout-scope-cards";

// ---------------------------------------------------------------------------
// Layout v50 (TODO 1.20): the type line in its printed order, and the P/T of
// a land that is also a creature. A card-scoped "sweep" on any template.
// ---------------------------------------------------------------------------

const V = TYPE_LINE_ORDER_LAYOUT_VERSION;
const png = "https://x/y.png";

/** A v48 bake of a card no earlier bump is pending on. */
const at = (template: string, over: Record<string, unknown> = {}) => ({
  ...UNTOUCHED_SINCE_V22,
  layout_version: V - 2,
  rendered_image_url: png,
  frame_style: { template, finish: "regular" },
  ...over,
});

/** What v49 printed left of the dash: the supertype as typed, then the card
 *  type ("Token", then the supertype, on a token; "Emblem" alone). */
function v49Line(face: { supertype: string | null; cardType: CardType }): string {
  if (face.cardType === "emblem") return "Emblem";
  const type = face.cardType.charAt(0).toUpperCase() + face.cardType.slice(1);
  const words = (face.supertype ?? "").split(/\s+/).filter(Boolean);
  return (face.cardType === "token" ? ["Token", ...words] : [...words, type]).join(" ");
}

/** v49's P/T rule: a creature, a token whose supertype says Creature (or
 *  that names no type at all), a Vehicle or a Spacecraft — with a value. */
function v49PrintsPt(face: { supertype: string | null; cardType: CardType; subtypes: string[]; power: string | null }): boolean {
  if (!face.power) return false;
  if (face.cardType === "creature") return true;
  const words = (face.supertype ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (face.cardType === "token" && words.includes("creature")) return true;
  if (face.subtypes.some((s) => ["vehicle", "spacecraft"].includes(s.toLowerCase()))) return true;
  return face.cardType === "token" && !["creature", "artifact", "enchantment"].some((word) => words.includes(word));
}

const SUPERTYPES: readonly (string | null)[] = [
  null,
  "",
  "Legendary",
  "Basic",
  "Snow",
  "Basic Snow",
  "Snow Basic",
  "World",
  "Kindred",
  "Tribal",
  "Host",
  "Artifact",
  "Enchantment",
  "Land",
  "Creature",
  "creature",
  "Planeswalker",
  "Legendary Artifact",
  "Artifact Legendary",
  "Legendary Enchantment",
  "Enchantment Artifact",
  "Artifact Enchantment",
  "Artifact Creature",
  "Creature Artifact",
  "Legendary Creature",
  "Land Creature",
  "Creature Land",
  "Comedic",
  "Land -",
  "Legendary Comedic Creature",
  "Creature Ancient",
  "Instant",
  "Token",
];

describe(`v${V} — the type line in its printed order + a land creature's P/T (TODO 1.20)`, () => {
  it("is the current version: a sweep, never a badge, verification-neutral, on no template list", () => {
    expect(V).toBe(50);
    expect(CARD_LAYOUT_VERSION).toBeGreaterThanOrEqual(V);
    expect(VERSION_ROLLOUT[V]).toBe("sweep");
    expect(rolloutPolicy(V)).toBe("sweep");
    expect(latestOptInVersion()).toBe(22);
    expect(VERSION_SCOPES[V]).toBeTypeOf("function");
    expect(VERIFICATION_NEUTRAL_VERSIONS).toContain(V);
    expect(VERIFICATION_SCOPED_VERSIONS[V]).toEqual([]);
  });

  it("v49 is RESERVED for the symbols as printed (PR #494): it changes no card until that scope lands", () => {
    // DELETE this test with the placeholder (RESERVED_SYMBOLS_PRINT_VERSION
    // and its VERSION_SCOPES line) when this branch and PR #494 meet: the
    // real v49 scope must be the one in VERSION_SCOPES, never `() => false`.
    expect(RESERVED_SYMBOLS_PRINT_VERSION).toBe(V - 1);
    expect("SYMBOLS_PRINT_LAYOUT_VERSION" in layoutVersion).toBe(false);
    expect(VERSION_SCOPES[V - 1]?.({})).toBe(false);
    // Without the placeholder a version with no scope is "every card".
    expect(isRenderStale(V - 2, "lotr", undefined, V - 1, UNTOUCHED_SINCE_V22)).toBe(false);
    expect(isRenderStale(V - 2, "lotr", undefined, V - 1, UNTOUCHED_SINCE_V22, {})).toBe(true);
  });

  it("the scope is exactly the faces whose printed line or P/T changes — every card type × supertype", () => {
    let changed = 0;
    for (const cardType of CARD_TYPE_VALUES) {
      for (const supertype of SUPERTYPES) {
        for (const subtypes of [[], ["Forest", "Dryad"], ["Vehicle"]]) {
          for (const power of [null, "1"]) {
            const face = { supertype, cardType, subtypes, power, toughness: power };
            const lineChanged = buildTypeLine(face) !== [v49Line(face), subtypes.join(" ")].filter(Boolean).join(" — ");
            const ptChanged = printsPowerToughness(face) !== v49PrintsPt(face);
            const row = { card_type: cardType, supertype, subtypes, power, toughness: power };
            const label = JSON.stringify(row);
            expect(v50FaceChanged(row), label).toBe(lineChanged || ptChanged);
            // The front face, and the same face as a back_face.
            const front = at("lotr", row);
            const back = at("lotr", { back_face: { ...row, title: "Back" } });
            expect(VERSION_SCOPES[V]!(front), label).toBe(lineChanged || ptChanged);
            expect(VERSION_SCOPES[V]!(back), `back ${label}`).toBe(lineChanged || ptChanged);
            expect(classifyForSweep(front), label).toBe(lineChanged || ptChanged ? "rebake" : "stamp");
            expect(hasNewerLook({ ...front, visibility: "public" }), label).toBe(false);
            if (lineChanged || ptChanged) changed += 1;
          }
        }
      }
    }
    // The grid is not vacuous either way.
    expect(changed).toBeGreaterThan(50);
  });

  it("names the cards TODO 1.20 lists, and leaves the lines every stored card prints alone", () => {
    const scope = VERSION_SCOPES[V]!;
    // Dryad Arbor: "Creature Land" → "Land Creature", and its 1/1.
    expect(scope(at("m15land", { card_type: "land", supertype: "Creature", subtypes: ["Forest", "Dryad"], power: "1", toughness: "1" }))).toBe(true);
    // Urza's Saga and a FIN Summon on the saga kind; Bident of Thassa.
    expect(scope(at("saga", { card_type: "enchantment", supertype: "Land", subtypes: ["Urza's", "Saga"] }))).toBe(true);
    expect(scope(at("saga", { card_type: "enchantment", supertype: "Creature", subtypes: ["Saga", "Dragon"], power: "9", toughness: "9" }))).toBe(true);
    expect(scope(at("nyx", { card_type: "enchantment", supertype: "Legendary Artifact" }))).toBe(true);
    // The supertypes production's public and unlisted cards carry
    // (anonymous read, 2026-10-08) — none in scope.
    for (const [card_type, supertype, power] of [
      ["creature", "Legendary", "2"],
      ["creature", "Artifact", "2"],
      ["creature", "Legendary Artifact", "2"],
      ["creature", "Legendary Enchantment", "2"],
      ["creature", "Snow", "2"],
      ["creature", "Ancient", "2"],
      ["creature", "legendary", "2"],
      ["artifact", "Legendary", null],
      ["artifact", "Legendary", "2"],
      ["artifact", "Land -", null],
      ["enchantment", "Legendary", null],
      ["enchantment", "Basic", null],
      ["enchantment", "Comedic saga", null],
      ["land", "Basic", null],
      ["land", "Legendary", null],
      ["planeswalker", "Legendary", null],
      ["planeswalker", "Legendary", "2"],
      ["instant", "Comedic", null],
      ["sorcery", "legendary", null],
      ["token", "Basic", null],
      ["token", "Creature", "1"],
      ["token", "", null],
    ] as const) {
      const row = at("m15", { card_type, supertype, power, toughness: power });
      expect(scope(row), `${card_type} ${supertype}`).toBe(false);
      expect(classifyForSweep(row), `${card_type} ${supertype}`).toBe("stamp");
    }
  });

  it("holds on every template, and is conservative for a row it cannot read", () => {
    const scope = VERSION_SCOPES[V]!;
    for (const template of FRAME_TEMPLATE_VALUES) {
      expect(isRenderStale(V - 1, template, undefined, V, at(template)), template).toBe(false);
      expect(isRenderStale(V - 1, template, undefined, V, at(template, { card_type: "land", supertype: "Creature" })), template).toBe(true);
    }
    for (const missing of ["card_type", "supertype", "subtypes", "power", "toughness", "back_face"]) {
      const row: Record<string, unknown> = { ...at("m15") };
      delete row[missing];
      expect(scope(row), missing).toBe(true);
    }
    // A current bake is current.
    expect(classifyForSweep(at("m15land", { card_type: "land", supertype: "Creature", layout_version: V }))).toBe("current");
  });
});
