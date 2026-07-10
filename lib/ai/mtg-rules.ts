// ---------------------------------------------------------------------------
// MTG design rules — pure helpers shared by every AI generation flow.
//
// This is the deterministic half of the card-design engine (lib/ai/card-design.ts
// is the model-calling half). Everything here is side-effect free and unit
// tested (tests/unit/ai/mtg-rules.test.ts):
//
//   - mana-cost grammar: parse curly-brace costs, compute mana value + colors
//   - design lint: template/shape errors an LLM commonly makes (wrong P/T
//     slots, color-identity drift, unknown keywords, outdated templating,
//     vanilla-test balance outliers)
//   - autofix: mechanical repairs for the invariants that would otherwise
//     fail createCardAction validation
//   - set skeleton: rarity/color quotas matching real (post-2024) set ratios
//
// The lint intentionally splits errors (must fix before save) from warnings
// (fed to the judge model, which decides whether a redesign is needed —
// custom keywords and pushed designs are legitimate homebrew choices).
// ---------------------------------------------------------------------------

import type { CardType, ColorIdentity, Rarity } from "@/types/card";

// ---------------------------------------------------------------------------
// Mana costs
// ---------------------------------------------------------------------------

export type ParsedManaCost = {
  symbols: string[];
  manaValue: number;
  /** WUBRG letters appearing in the cost (C/S/P excluded). */
  colorLetters: ColorLetter[];
};

export type ColorLetter = "W" | "U" | "B" | "R" | "G";

const COLOR_LETTER_TO_WORD: Record<ColorLetter, ColorIdentity> = {
  W: "white",
  U: "blue",
  B: "black",
  R: "red",
  G: "green",
};

const WORD_TO_COLOR_LETTER: Partial<Record<ColorIdentity, ColorLetter>> = {
  white: "W",
  blue: "U",
  black: "B",
  red: "R",
  green: "G",
};

// One curly-brace symbol. Grammar covers everything the creator's pip
// renderer understands: generics {0}-{99}, variables {X}{Y}{Z}, colors
// {W}{U}{B}{R}{G}, colorless {C}, snow {S}, two-color hybrid {W/U},
// mono hybrid {2/W}, Phyrexian {W/P} and hybrid Phyrexian {W/U/P}.
const SYMBOL_RE =
  /^(?:\d{1,2}|[XYZ]|[WUBRGCS]|[WUBRG]\/[WUBRG]|2\/[WUBRG]|[WUBRG]\/P|[WUBRG]\/[WUBRG]\/P)$/;

/** Costs that mean "this card has no mana cost" (lands, some tokens). */
export function isNoCost(cost: string | null | undefined): boolean {
  const trimmed = (cost ?? "").trim();
  return trimmed === "" || trimmed === "—" || trimmed === "-";
}

/**
 * Parse a curly-brace mana cost. Returns null when the string contains
 * anything that isn't a valid mana symbol (stray text, unclosed braces,
 * unknown letters).
 */
export function parseManaCost(cost: string): ParsedManaCost | null {
  const trimmed = cost.trim();
  if (isNoCost(trimmed)) return { symbols: [], manaValue: 0, colorLetters: [] };

  // The whole string must be a run of {…} groups (spaces tolerated).
  const compact = trimmed.replace(/\s+/g, "");
  const groups = compact.match(/\{[^{}]*\}/g) ?? [];
  if (groups.join("") !== compact) return null;

  const symbols: string[] = [];
  let manaValue = 0;
  const colors = new Set<ColorLetter>();

  for (const group of groups) {
    const symbol = group.slice(1, -1).toUpperCase();
    if (!SYMBOL_RE.test(symbol)) return null;
    // Hybrid pairs must be two DIFFERENT colors ({R/R} isn't a symbol).
    const hybrid = symbol.match(/^([WUBRG])\/([WUBRG])(?:\/P)?$/);
    if (hybrid && hybrid[1] === hybrid[2]) return null;
    symbols.push(symbol);

    if (/^\d+$/.test(symbol)) {
      manaValue += Number(symbol);
    } else if (symbol.startsWith("2/")) {
      manaValue += 2;
    } else if (!/^[XYZ]$/.test(symbol)) {
      manaValue += 1;
    }

    for (const part of symbol.split("/")) {
      if (part in COLOR_LETTER_TO_WORD) colors.add(part as ColorLetter);
    }
  }

  return { symbols, manaValue, colorLetters: [...colors].sort() };
}

/**
 * Colors a card commits to: its mana cost plus any mana symbols used in its
 * rules text (activation costs, alternative costs).
 */
export function deriveColorLetters(
  cost: string | null | undefined,
  rulesText: string | null | undefined,
): ColorLetter[] {
  const colors = new Set<ColorLetter>();
  const costParse = parseManaCost(cost ?? "");
  for (const letter of costParse?.colorLetters ?? []) colors.add(letter);

  for (const match of (rulesText ?? "").matchAll(/\{([^{}]+)\}/g)) {
    const symbol = match[1].toUpperCase();
    if (!SYMBOL_RE.test(symbol)) continue;
    for (const part of symbol.split("/")) {
      if (part in COLOR_LETTER_TO_WORD) colors.add(part as ColorLetter);
    }
  }
  return [...colors].sort();
}

/** Map WUBRG letters to the cards-table color_identity word enum. */
export function colorWordsFromLetters(letters: ColorLetter[]): ColorIdentity[] {
  if (letters.length === 0) return ["colorless"];
  const words = letters.map((letter) => COLOR_LETTER_TO_WORD[letter]);
  return letters.length > 1 ? [...words, "multicolor"] : words;
}

/** Map the word enum back to WUBRG letters (deck_cards uses letters). */
export function colorLettersFromWords(words: ColorIdentity[]): ColorLetter[] {
  const letters = new Set<ColorLetter>();
  for (const word of words) {
    const letter = WORD_TO_COLOR_LETTER[word];
    if (letter) letters.add(letter);
  }
  return [...letters].sort();
}

// ---------------------------------------------------------------------------
// Keyword vocabulary
// ---------------------------------------------------------------------------

// Evergreen + widely-known set keywords. Used only for a WARNING when a
// keyword-looking line isn't recognized AND carries no reminder text —
// original named mechanics are a legitimate part of custom-set design as
// long as the card explains itself.
const KNOWN_KEYWORDS = new Set(
  [
    // evergreen
    "deathtouch", "defender", "double strike", "enchant", "equip",
    "first strike", "flash", "flying", "haste", "hexproof",
    "indestructible", "lifelink", "menace", "protection", "reach",
    "trample", "vigilance", "ward",
    // common deciduous / historical
    "shroud", "intimidate", "fear", "prowess", "banding", "flanking",
    "phasing", "horsemanship", "shadow", "regenerate",
    // widely-used set keywords
    "affinity", "afflict", "afterlife", "amass", "annihilator", "ascend",
    "backup", "battle cry", "bestow", "blitz", "bloodthirst", "buyback",
    "cascade", "casualty", "champion", "changeling", "cleave", "connive",
    "convoke", "crew", "cumulative upkeep", "cycling", "dash", "daybound",
    "nightbound", "decayed", "delve", "devoid", "devour", "discover",
    "disturb", "dredge", "echo", "embalm", "emerge", "enrage", "entwine",
    "escalate", "escape", "eternalize", "evoke", "evolve", "exalted",
    "exploit", "extort", "fabricate", "fading", "flashback", "foretell",
    "fortify", "fuse", "graft", "haunt", "hideaway", "improvise",
    "incubate", "infect", "ingest", "kicker", "multikicker", "level up",
    "living weapon", "madness", "megamorph", "melee", "mentor",
    "miracle", "modular", "morph", "mutate", "myriad", "ninjutsu",
    "offering", "overload", "partner", "persist", "poisonous", "populate",
    "proliferate", "prototype", "provoke", "prowl", "rampage", "ravenous",
    "rebound", "reconfigure", "recover", "reinforce", "renown",
    "replicate", "retrace", "riot", "ripple", "scavenge", "skulk",
    "soulbond", "soulshift", "spectacle", "splice", "split second",
    "storm", "sunburst", "surge", "suspend", "toxic", "training",
    "transmute", "tribute", "undying", "unearth", "unleash", "vanishing",
    "wither",
  ].map((k) => k.toLowerCase()),
);

function isKnownKeyword(rawToken: string): boolean {
  // Strip parameter tails: "ward {2}", "crew 2", "protection from red",
  // "suspend 3—{1}{R}", "cycling {2}".
  const token = rawToken
    .toLowerCase()
    .replace(/\s*(\{.*|\d.*|from .*|—.*|--.*)$/u, "")
    .trim();
  if (token.length === 0) return false;
  if (KNOWN_KEYWORDS.has(token)) return true;
  if (token.endsWith("walk")) return true; // islandwalk, swampwalk, …
  return false;
}

// ---------------------------------------------------------------------------
// Design lint
// ---------------------------------------------------------------------------

export type LintIssue = {
  field:
    | "cost"
    | "rules_text"
    | "power"
    | "toughness"
    | "loyalty"
    | "defense"
    | "color_identity"
    | "balance";
  message: string;
};

export type LintResult = {
  /** Shape/template problems — must be fixed before the card is saved. */
  errors: LintIssue[];
  /** Style/balance concerns — handed to the judge model, never blocking. */
  warnings: LintIssue[];
};

export type LintableCard = {
  title: string;
  cost: string;
  card_type: CardType;
  color_identity: ColorIdentity[];
  rules_text: string;
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  defense: string | null;
};

const OUTDATED_TEMPLATING: Array<{ pattern: RegExp; fix: string }> = [
  { pattern: /\bhis or her\b/i, fix: 'use "their"' },
  { pattern: /\bin play\b/i, fix: 'use "on the battlefield"' },
  {
    pattern: /\bremoved? (?:\w+ )*from the game\b/i,
    fix: 'use "exile" wording',
  },
  { pattern: /\bgoes to the graveyard\b/i, fix: 'use "dies" or "is put into a graveyard"' },
  { pattern: /\bcannot\b/, fix: 'use "can\'t"' },
  { pattern: /\binterrupt\b/i, fix: "interrupts no longer exist; use instant wording" },
];

const DRAWBACK_HINTS =
  /\b(defender|can't attack|can't block|enters (?:the battlefield )?tapped|sacrifice|upkeep|discard|lose \d+ life|pay \d+ life|exile it|at the beginning of your end step|cumulative upkeep|echo|fading|vanishing|when [^.]* dies)\b/i;

function statNumber(value: string | null): number | null {
  if (value == null) return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null; // "*" / "X" stats skip math
}

/**
 * Lint one designed card. Errors are template/shape violations we refuse to
 * save; warnings are judgement calls forwarded to the judge model.
 */
export function lintCardDesign(card: LintableCard): LintResult {
  const errors: LintIssue[] = [];
  const warnings: LintIssue[] = [];
  const type = card.card_type;

  // ---- Mana cost grammar ----
  const parsed = parseManaCost(card.cost);
  if (parsed === null) {
    errors.push({
      field: "cost",
      message: `Mana cost "${card.cost}" isn't valid curly-brace notation.`,
    });
  }
  if (type === "land" && parsed !== null && parsed.symbols.length > 0) {
    errors.push({ field: "cost", message: "Lands don't have a mana cost — use \"—\"." });
  }
  if (type !== "land" && type !== "token" && isNoCost(card.cost)) {
    warnings.push({
      field: "cost",
      message: "Nonland card with no mana cost — intentional (e.g. suspend-only) or a mistake?",
    });
  }

  // ---- Stat slots per type ----
  const isCreatureLike = type === "creature" || type === "token";
  if (isCreatureLike) {
    if (card.power == null || card.toughness == null) {
      errors.push({
        field: card.power == null ? "power" : "toughness",
        message: "Creatures and tokens need both power and toughness.",
      });
    }
  } else {
    if (card.power != null || card.toughness != null) {
      errors.push({
        field: "power",
        message: `${type} cards don't have power/toughness.`,
      });
    }
  }
  if (type === "planeswalker" && card.loyalty == null) {
    errors.push({ field: "loyalty", message: "Planeswalkers need starting loyalty." });
  }
  if (type !== "planeswalker" && card.loyalty != null) {
    errors.push({ field: "loyalty", message: `${type} cards don't have loyalty.` });
  }
  if (type === "battle" && card.defense == null) {
    errors.push({ field: "defense", message: "Battles need a defense value." });
  }
  if (type !== "battle" && card.defense != null) {
    errors.push({ field: "defense", message: `${type} cards don't have defense.` });
  }

  // ---- Color identity consistency ----
  const derived = deriveColorLetters(card.cost, card.rules_text);
  const declared = new Set(colorLettersFromWords(card.color_identity));
  const missing = derived.filter((letter) => !declared.has(letter));
  if (missing.length > 0) {
    errors.push({
      field: "color_identity",
      message: `Mana symbols use ${missing.join(", ")} but color_identity doesn't include ${missing
        .map((l) => COLOR_LETTER_TO_WORD[l])
        .join(", ")}.`,
    });
  }
  if (
    derived.length === 0 &&
    type !== "land" && // lands legitimately claim identity via abilities/flavor
    !card.color_identity.includes("colorless") &&
    card.color_identity.length > 0
  ) {
    warnings.push({
      field: "color_identity",
      message: "No colored mana symbols anywhere — should this be colorless?",
    });
  }

  // ---- Keyword line ----
  const firstLine = card.rules_text.split("\n")[0]?.trim() ?? "";
  const looksLikeKeywordLine =
    firstLine.length > 0 &&
    /^[A-Za-z][A-Za-z0-9 {}/,'’—-]*$/.test(firstLine) &&
    !/[.:]/.test(firstLine) &&
    firstLine.split(" ").length <= 12;
  if (looksLikeKeywordLine) {
    const hasReminder = card.rules_text.includes("(");
    for (const token of firstLine.split(",")) {
      const cleaned = token.trim();
      if (cleaned.length === 0) continue;
      if (!isKnownKeyword(cleaned) && !hasReminder) {
        warnings.push({
          field: "rules_text",
          message: `"${cleaned}" isn't a known keyword and has no reminder text — add reminder text or use a standard keyword.`,
        });
      }
    }
  }

  // ---- Outdated templating ----
  for (const { pattern, fix } of OUTDATED_TEMPLATING) {
    if (pattern.test(card.rules_text)) {
      warnings.push({
        field: "rules_text",
        message: `Outdated templating (${pattern.source}) — ${fix}.`,
      });
    }
  }

  // ---- Vanilla-test balance (coarse; judge decides what to do) ----
  if (isCreatureLike && parsed !== null && !isNoCost(card.cost)) {
    const power = statNumber(card.power);
    const toughness = statNumber(card.toughness);
    if (power !== null && toughness !== null) {
      const stats = power + toughness;
      const budget = 2 * parsed.manaValue + 3;
      if (stats > budget && !DRAWBACK_HINTS.test(card.rules_text)) {
        warnings.push({
          field: "balance",
          message: `${power}/${toughness} for mana value ${parsed.manaValue} with no drawback looks overpowered.`,
        });
      }
      if (parsed.manaValue >= 4 && stats <= parsed.manaValue - 2 && card.rules_text.trim().length < 40) {
        warnings.push({
          field: "balance",
          message: `${power}/${toughness} for mana value ${parsed.manaValue} with little text looks underpowered.`,
        });
      }
    }
  }
  if (!isCreatureLike && type !== "land" && parsed !== null && parsed.manaValue === 0 && parsed.symbols.length === 0 && !isNoCost(card.cost)) {
    warnings.push({ field: "balance", message: "Zero-cost spell — make sure the effect justifies it." });
  }

  return { errors, warnings };
}

/**
 * Mechanical repairs for lint ERRORS the model failed to fix itself — the
 * last line of defense so a batch generation never hands createCardAction a
 * card that violates its own type's shape. Never touches design intent
 * (costs/rules text stay as generated, except outdated-phrase swaps).
 */
export function autofixCard<T extends LintableCard>(card: T): T {
  const fixed = { ...card };
  const type = fixed.card_type;
  const isCreatureLike = type === "creature" || type === "token";

  if (!isCreatureLike) {
    fixed.power = null;
    fixed.toughness = null;
  } else {
    if (fixed.power == null) fixed.power = "2";
    if (fixed.toughness == null) fixed.toughness = "2";
  }
  if (type !== "planeswalker") fixed.loyalty = null;
  else if (fixed.loyalty == null) fixed.loyalty = "3";
  if (type !== "battle") fixed.defense = null;
  else if (fixed.defense == null) fixed.defense = "3";

  if (type === "land") fixed.cost = "—";

  // Realign declared identity with the symbols actually used.
  const derived = deriveColorLetters(fixed.cost, fixed.rules_text);
  if (derived.length > 0 || type !== "land") {
    fixed.color_identity = colorWordsFromLetters(derived);
  }

  fixed.rules_text = fixed.rules_text
    .replace(/\bhis or her\b/gi, "their")
    .replace(/\bcannot\b/g, "can't");

  return fixed;
}

// ---------------------------------------------------------------------------
// Set skeleton — rarity/color quotas
// ---------------------------------------------------------------------------

export type SkeletonSlot = {
  rarity: Rarity;
  /** Suggested color; the model may go multicolor/artifact when it fits. */
  colorHint: ColorIdentity | null;
  /** Soft role nudge so sets don't come back as 100% creatures. */
  roleHint: "creature" | "noncreature" | "any";
};

// Post-2024 "play booster era" main-set ratios: 81C/100U/60R/20M ≈ 31/38/23/8.
const RARITY_RATIO: Array<{ rarity: Rarity; weight: number }> = [
  { rarity: "common", weight: 0.31 },
  { rarity: "uncommon", weight: 0.38 },
  { rarity: "rare", weight: 0.23 },
  { rarity: "mythic", weight: 0.08 },
];

const COLOR_WHEEL: ColorIdentity[] = ["white", "blue", "black", "red", "green"];

// Descending creature share by color at common (Rosewater design skeleton):
// white/green run creature-heavy, blue runs spell-heavy.
const CREATURE_SHARE: Partial<Record<ColorIdentity, number>> = {
  white: 0.7,
  green: 0.7,
  red: 0.62,
  black: 0.6,
  blue: 0.52,
};

/**
 * Allocate rarities for an N-card set using largest-remainder rounding on
 * real set ratios. Small sets degrade sensibly (3 → 1C/1U/1R).
 */
export function buildRaritySkeleton(count: number): Rarity[] {
  const total = Math.max(1, Math.floor(count));
  const allocations = RARITY_RATIO.map(({ rarity, weight }) => {
    const exact = total * weight;
    return { rarity, base: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let assigned = allocations.reduce((sum, a) => sum + a.base, 0);
  const byRemainder = [...allocations].sort((a, b) => b.remainder - a.remainder);
  for (let i = 0; assigned < total; i += 1, assigned += 1) {
    byRemainder[i % byRemainder.length].base += 1;
  }

  const result: Rarity[] = [];
  for (const { rarity, base } of allocations) {
    for (let i = 0; i < base; i += 1) result.push(rarity);
  }
  return result;
}

/**
 * Full skeleton: rarity + color + role hints. Colors cycle WUBRG within each
 * rarity band so even a 5-card set touches every color once; every ~7th slot
 * frees the color so the model can add artifacts/multicolor glue.
 */
export function buildSetSkeleton(count: number): SkeletonSlot[] {
  const rarities = buildRaritySkeleton(count);
  return rarities.map((rarity, index) => {
    const freeSlot = count >= 7 && index % 7 === 6;
    const colorHint = freeSlot ? null : COLOR_WHEEL[index % COLOR_WHEEL.length];
    const creatureShare = colorHint ? (CREATURE_SHARE[colorHint] ?? 0.6) : 0.4;
    // Deterministic creature/noncreature interleave approximating the share:
    // slot i within its color is a creature while the running ratio is below
    // target. index/5 ≈ position within the color's own sequence.
    const positionInColor = Math.floor(index / COLOR_WHEEL.length);
    const roleHint: SkeletonSlot["roleHint"] =
      rarity === "mythic"
        ? "any"
        : (positionInColor + 1) * creatureShare >= positionInColor + 0.5
          ? "creature"
          : "noncreature";
    return { rarity, colorHint, roleHint };
  });
}
