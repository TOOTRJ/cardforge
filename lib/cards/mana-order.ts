// ---------------------------------------------------------------------------
// Canonical mana-cost ordering.
//
// Real printed cards order their cost symbols deterministically:
//   {X} → generic number → {S} → {C} → colored symbols → {T}/{Q} → {E}
// with colored symbols following the color wheel's shortest arc — the same
// sequences WotC prints on shards ({U}{B}{R}), wedges ({R}{W}{B}) and
// guild pairs ({G}{W}).
//
// `normalizeManaCost` rewrites a cost string into that canonical order.
// It is deliberately conservative: if the cost contains anything outside
// the known token grammar (freeform text, custom symbols), the input is
// returned unchanged rather than risk mangling user data.
//
// Pure + client-safe: used by the mana-cost picker on every click and by
// the create/update card actions as defense in depth.
// ---------------------------------------------------------------------------

const WHEEL = "WUBRG";

// Canonical color sequences as printed on real cards: 5 mono, 10 pairs
// (guilds), 5 shards, 5 wedges, 5 four-color, 1 five-color. Keyed below by
// the WUBRG-sorted color set, so any combination of colors resolves to the
// order WotC actually prints.
const CANONICAL_SEQUENCES = [
  "W",
  "U",
  "B",
  "R",
  "G",
  "WU",
  "WB",
  "UB",
  "UR",
  "BR",
  "BG",
  "RG",
  "RW",
  "GW",
  "GU",
  "WUB",
  "UBR",
  "BRG",
  "RGW",
  "GWU",
  "WBG",
  "URW",
  "BGU",
  "RWB",
  "GUR",
  "WUBR",
  "UBRG",
  "BRGW",
  "RGWU",
  "GWUB",
  "WUBRG",
] as const;

function sortByWheel(colors: string): string {
  return [...colors]
    .sort((a, b) => WHEEL.indexOf(a) - WHEEL.indexOf(b))
    .join("");
}

const SEQUENCE_BY_KEY = new Map(
  CANONICAL_SEQUENCES.map((seq) => [sortByWheel(seq), seq] as const),
);

// Canonical internal order for hybrid pairs ({U/W} prints as {W/U}).
const HYBRID_PAIRS = [
  "WU",
  "WB",
  "UB",
  "UR",
  "BR",
  "BG",
  "RG",
  "RW",
  "GW",
  "GU",
] as const;

const HYBRID_PAIR_BY_KEY = new Map(
  HYBRID_PAIRS.map((pair) => [sortByWheel(pair), pair] as const),
);

/** Resolve a set of colors to the canonical printed sequence. */
export function canonicalColorSequence(colors: Iterable<string>): string {
  const unique = [...new Set(colors)].filter((c) => WHEEL.includes(c));
  if (unique.length === 0) return "";
  return SEQUENCE_BY_KEY.get(sortByWheel(unique.join(""))) ?? WHEEL;
}

// ---------------------------------------------------------------------------
// Token model. Group ranks define the coarse ordering; colored tokens are
// then indexed into the cost's canonical color sequence.
// ---------------------------------------------------------------------------

type ParsedToken = {
  /** Re-emitted symbol, already normalized (hybrid pair order fixed). */
  symbol: string;
  group:
    | "variable" // {X} {Y} {Z}
    | "generic" // {0}..{n}
    | "snow" // {S}
    | "colorless" // {C} {C/P}
    | "colored" // solid / hybrid / twobrid / phyrexian
    | "tap" // {T} {Q}
    | "energy"; // {E}
  /** Numeric value for generic tokens (summed during normalization). */
  value?: number;
  /** Colors this token contributes, in the token's own display order. */
  colors?: string[];
  /** Tiebreaker within the variable group (X before Y before Z). */
  variableRank?: number;
};

const COLOR_RE = /^[WUBRG]$/;

/**
 * Parse the inside of one `{...}` token. Returns null when the token isn't
 * part of the standard grammar — the caller then bails out entirely.
 */
function parseToken(raw: string): ParsedToken | null {
  const inner = raw.trim().toUpperCase();

  if (/^\d+$/.test(inner)) {
    return { symbol: `{${Number(inner)}}`, group: "generic", value: Number(inner) };
  }
  if (inner === "X" || inner === "Y" || inner === "Z") {
    return {
      symbol: `{${inner}}`,
      group: "variable",
      variableRank: inner === "X" ? 0 : inner === "Y" ? 1 : 2,
    };
  }
  if (COLOR_RE.test(inner)) {
    return { symbol: `{${inner}}`, group: "colored", colors: [inner] };
  }
  if (inner === "C") return { symbol: "{C}", group: "colorless" };
  if (inner === "S") return { symbol: "{S}", group: "snow" };
  if (inner === "T") return { symbol: "{T}", group: "tap" };
  if (inner === "Q") return { symbol: "{Q}", group: "tap" };
  if (inner === "E") return { symbol: "{E}", group: "energy" };

  const parts = inner.split("/");

  // Phyrexian: {W/P} and colorless {C/P}.
  if (parts.length === 2 && parts[1] === "P") {
    if (COLOR_RE.test(parts[0])) {
      return { symbol: `{${parts[0]}/P}`, group: "colored", colors: [parts[0]] };
    }
    if (parts[0] === "C") return { symbol: "{C/P}", group: "colorless" };
    return null;
  }

  // Twobrid: {2/W}.
  if (parts.length === 2 && /^\d+$/.test(parts[0]) && COLOR_RE.test(parts[1])) {
    return {
      symbol: `{${Number(parts[0])}/${parts[1]}}`,
      group: "colored",
      colors: [parts[1]],
    };
  }

  // Hybrid: {W/U} — normalize the pair to its canonical internal order.
  if (parts.length === 2 && COLOR_RE.test(parts[0]) && COLOR_RE.test(parts[1])) {
    if (parts[0] === parts[1]) return null;
    const pair = HYBRID_PAIR_BY_KEY.get(sortByWheel(parts[0] + parts[1]));
    if (!pair) return null;
    return {
      symbol: `{${pair[0]}/${pair[1]}}`,
      group: "colored",
      colors: [pair[0], pair[1]],
    };
  }

  // Hybrid phyrexian: {G/U/P} — hybrid pair order fixed, /P suffix kept.
  if (
    parts.length === 3 &&
    parts[2] === "P" &&
    COLOR_RE.test(parts[0]) &&
    COLOR_RE.test(parts[1])
  ) {
    if (parts[0] === parts[1]) return null;
    const pair = HYBRID_PAIR_BY_KEY.get(sortByWheel(parts[0] + parts[1]));
    if (!pair) return null;
    return {
      symbol: `{${pair[0]}/${pair[1]}/P}`,
      group: "colored",
      colors: [pair[0], pair[1]],
    };
  }

  return null;
}

const GROUP_RANK: Record<ParsedToken["group"], number> = {
  variable: 0,
  generic: 1,
  snow: 2,
  colorless: 3,
  colored: 4,
  tap: 5,
  energy: 6,
};

/**
 * Rewrite a mana cost string into canonical printed order. Returns the
 * input unchanged when it contains anything outside the standard token
 * grammar (custom pips, freeform text) so user data is never destroyed.
 *
 * Multiple generic tokens are merged by summing ({4}{C}{4}{C} → {8}{C}{C}).
 * A lone {0} is preserved (Ornithopter), but a {0} alongside other mana is
 * dropped — real costs never print both.
 */
export function normalizeManaCost(cost: string): string {
  if (!cost) return cost;

  // Everything must be {token} groups; any stray text outside braces means
  // this isn't a standard cost — leave it alone.
  const outside = cost.replace(/\{[^}]*\}/g, "");
  if (outside.trim() !== "") return cost;

  const rawTokens = [...cost.matchAll(/\{([^}]*)\}/g)].map((m) => m[1]);
  if (rawTokens.length === 0) return cost;

  const tokens: ParsedToken[] = [];
  for (const raw of rawTokens) {
    const parsed = parseToken(raw);
    if (!parsed) return cost;
    tokens.push(parsed);
  }

  // Merge generic numbers into a single token.
  const genericSum = tokens
    .filter((t) => t.group === "generic")
    .reduce((sum, t) => sum + (t.value ?? 0), 0);
  const hadGeneric = tokens.some((t) => t.group === "generic");
  const nonGeneric = tokens.filter((t) => t.group !== "generic");

  const merged: ParsedToken[] = [...nonGeneric];
  if (hadGeneric && (genericSum > 0 || nonGeneric.length === 0)) {
    merged.push({
      symbol: `{${genericSum}}`,
      group: "generic",
      value: genericSum,
    });
  }

  // Canonical color sequence for THIS cost's color set — hybrids and
  // twobrids contribute their colors too (Naya Hushblade prints {R/W}
  // before {G} because the cost's set is RGW).
  const sequence = canonicalColorSequence(
    merged.flatMap((t) => t.colors ?? []),
  );

  // Verified against real printings: hybrids sit just after their primary
  // color — Tamiyo, Compleated Sage is {2}{G}{G/U/P}{U} and Naya Hushblade
  // is {R/W}{G}. Solid/twobrid/phyrexian pips sort exactly at their
  // color's index; two-color hybrids at primary index + 0.5.
  const colorIndex = (token: ParsedToken): number => {
    if (!token.colors || token.colors.length === 0) return 0;
    const indices = token.colors
      .map((c) => sequence.indexOf(c))
      .filter((i) => i >= 0);
    if (indices.length === 0) return 0;
    const primary = Math.min(...indices);
    return token.colors.length > 1 ? primary + 0.5 : primary;
  };

  const sorted = [...merged].sort((a, b) => {
    const groupDiff = GROUP_RANK[a.group] - GROUP_RANK[b.group];
    if (groupDiff !== 0) return groupDiff;
    if (a.group === "variable") {
      return (a.variableRank ?? 0) - (b.variableRank ?? 0);
    }
    if (a.group === "colored") {
      const indexDiff = colorIndex(a) - colorIndex(b);
      if (indexDiff !== 0) return indexDiff;
      // Group identical symbols; among same-color tokens keep solid pips
      // before hybrids/twobrids deterministically via the symbol string.
      return a.symbol.localeCompare(b.symbol);
    }
    if (a.group === "tap") {
      // {T} before {Q}.
      return a.symbol === b.symbol ? 0 : a.symbol === "{T}" ? -1 : 1;
    }
    return 0;
  });

  return sorted.map((t) => t.symbol).join("");
}
