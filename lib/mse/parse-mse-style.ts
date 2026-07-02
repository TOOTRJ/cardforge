// ---------------------------------------------------------------------------
// Magic Set Editor `.mse-style/style` parser — just enough of the format to
// extract element geometry for the frame-profile review report
// (scripts/import-mse-profiles.mjs).
//
// The format is an indentation-based key/value tree:
//
//   card style:
//     name:
//       left: { if card.card_symbol == "none" then 52 else 32 }
//       top: 30
//       height: 23
//       font:
//         name: Beleren Bold
//         size: 16
//
// Values may be plain numbers, strings, or MSE script expressions in braces.
// We resolve literals and if/else chains (taking the final else branch — the
// "no indicator / no symbol" default); anything content-dependent
// (content_width etc.) is surfaced as `dynamic` with the raw expression so a
// human can judge it in the report.
//
// Pure and dependency-free so it's unit-testable and importable from a plain
// node script.
// ---------------------------------------------------------------------------

export type MseNode = {
  /** Scalar value when the line was `key: value`; undefined for block keys. */
  value?: string;
  /** Child nodes for indented blocks. Repeated keys keep the FIRST block
   *  (later duplicates are ignored — the card style block is what we read,
   *  and its element keys are unique within it). */
  children: Map<string, MseNode>;
};

export type ResolvedValue = {
  px: number | null;
  strategy: "literal" | "then-branch" | "else-branch" | "dynamic" | "missing";
  raw: string | null;
};

/** Parse the style text into a tree. Indentation is measured in leading
 *  tab characters (the packs use tabs); runs of 4 spaces count as one level
 *  as a fallback. Comment lines (#…) and blanks are skipped. */
export function parseMseStyle(text: string): MseNode {
  const root: MseNode = { children: new Map() };
  // Stack of open blocks with their depths; the parent of a line is the
  // deepest open block SHALLOWER than the line (depth jumps and script
  // continuations in real pack files make gap-free depths unreliable).
  const stack: Array<{ depth: number; node: MseNode }> = [
    { depth: -1, node: root },
  ];

  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trim().startsWith("#")) continue;

    const indentMatch = rawLine.match(/^[\t ]*/)?.[0] ?? "";
    const depth =
      (indentMatch.match(/\t/g)?.length ?? 0) +
      Math.floor((indentMatch.match(/ /g)?.length ?? 0) / 4);

    const line = rawLine.trim();
    const colon = line.indexOf(":");
    if (colon === -1) {
      // Continuation of a multi-line script value — we don't evaluate
      // scripts, so skip.
      continue;
    }
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (!key) continue;

    while (stack.length > 1 && stack[stack.length - 1].depth >= depth) {
      stack.pop();
    }
    const parent = stack[stack.length - 1].node;

    const node: MseNode = {
      value: value.length > 0 ? value : undefined,
      children: new Map(),
    };
    // Keep the FIRST block for repeated keys (styling fields repeat; the
    // card-style elements we read are unique within their block).
    if (!parent.children.has(key)) parent.children.set(key, node);
    const kept = parent.children.get(key)!;

    stack.push({ depth, node: kept });
  }

  return root;
}

/** Walk a dotted path of lowercase keys, e.g. get(root, "card style", "name"). */
export function getNode(
  node: MseNode | undefined,
  ...path: string[]
): MseNode | undefined {
  let cur = node;
  for (const key of path) {
    cur = cur?.children.get(key.toLowerCase());
    if (!cur) return undefined;
  }
  return cur;
}

/** Resolve a raw MSE value to pixels.
 *  - plain number → literal
 *  - `{ if <cond> then A else B }` chains → the PLAIN-CARD branch: when the
 *    condition tests for a feature being ABSENT (`== "none"`, `not …`), the
 *    then-branch is the default; otherwise the final else-branch is (e.g.
 *    `if has_identity() then "52" else "32"`). Numbers may be quoted.
 *  - anything content-dependent (content_width / content_lines) or without a
 *    resolvable branch → dynamic (px null, raw preserved for the report)
 */
export function resolveMseValue(raw: string | undefined): ResolvedValue {
  if (raw === undefined || raw === "") {
    return { px: null, strategy: "missing", raw: null };
  }
  const trimmed = raw.trim();
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return { px: Number(trimmed), strategy: "literal", raw: trimmed };
  }
  if (trimmed.startsWith("{")) {
    if (/content_width|content_lines/.test(trimmed)) {
      // Content-dependent even if a numeric branch exists — a human call.
      return { px: null, strategy: "dynamic", raw: trimmed };
    }
    const firstCondition = trimmed.match(/if\s+(.+?)\s+then/)?.[1] ?? "";
    const absentFeature = /==\s*"none"|(?:^|\W)not\s/.test(firstCondition);
    if (absentFeature) {
      const thenMatch = trimmed.match(/then\s+"?(-?\d+(?:\.\d+)?)"?/);
      if (thenMatch) {
        return { px: Number(thenMatch[1]), strategy: "then-branch", raw: trimmed };
      }
    }
    const elseMatches = [...trimmed.matchAll(/else\s+"?(-?\d+(?:\.\d+)?)"?/g)];
    const last = elseMatches[elseMatches.length - 1];
    if (last) {
      return { px: Number(last[1]), strategy: "else-branch", raw: trimmed };
    }
    return { px: null, strategy: "dynamic", raw: trimmed };
  }
  return { px: null, strategy: "dynamic", raw: trimmed };
}

export type MseElementGeometry = {
  leftPct: number | null;
  topPct: number | null;
  widthPct: number | null;
  heightPct: number | null;
  /** Font size as a fraction of card WIDTH (matches FrameProfile sizePct). */
  fontSizeFrac: number | null;
  /** Symbol font size fraction (casting cost pips / set symbol). */
  symbolFontSizeFrac: number | null;
  /** Raw expressions for any field that couldn't be resolved. */
  dynamic: Record<string, string>;
};

/** Card dimensions from the style header (falls back to 375×523). */
export function cardDimensions(root: MseNode): { w: number; h: number } {
  const w = resolveMseValue(getNode(root, "card width")?.value).px ?? 375;
  const h = resolveMseValue(getNode(root, "card height")?.value).px ?? 523;
  return { w, h };
}

/** Extract one card-style element's geometry in card-relative percents. */
export function extractElement(
  root: MseNode,
  elementKey: string,
): MseElementGeometry | null {
  const el = getNode(root, "card style", elementKey);
  if (!el) return null;
  const { w, h } = cardDimensions(root);

  const dynamic: Record<string, string> = {};
  const grab = (key: string): number | null => {
    const r = resolveMseValue(getNode(el, key)?.value);
    if (r.px === null && r.raw) dynamic[key] = r.raw;
    return r.px;
  };

  const left = grab("left");
  const top = grab("top");
  let width = grab("width");
  const height = grab("height");
  const right = grab("right");
  if (width === null && right !== null && left !== null) width = right - left;

  const fontSize = resolveMseValue(getNode(el, "font", "size")?.value);
  const symbolSize = resolveMseValue(getNode(el, "symbol font", "size")?.value);

  const pct = (v: number | null, total: number) =>
    v === null ? null : Math.round((v / total) * 10000) / 100;

  return {
    leftPct: pct(left, w),
    topPct: pct(top, h),
    widthPct: pct(width, w),
    heightPct: pct(height, h),
    fontSizeFrac:
      fontSize.px === null ? null : Math.round((fontSize.px / w) * 10000) / 10000,
    symbolFontSizeFrac:
      symbolSize.px === null
        ? null
        : Math.round((symbolSize.px / w) * 10000) / 10000,
    dynamic,
  };
}
