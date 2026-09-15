// ---------------------------------------------------------------------------
// Pip runs — split free text ("{T}: Add {G}.") into literal text and mana
// symbols WITHOUT touching whitespace, so prose can be re-rendered with real
// pips in place of the brace codes (idea chips, AI suggestions, the creator's
// rules editor). `tokenize()` in mana-cost-glyphs trims text runs because it
// models a cost line; this keeps them verbatim because it models a sentence.
//
// Only codes the mana font can draw become pips; anything else ("{foo}")
// stays literal text so nothing is silently dropped.
// ---------------------------------------------------------------------------

import { tokenize, tokenSuffix } from "@/components/cards/mana-cost-glyphs";

export type PipRun =
  | { kind: "text"; value: string }
  | { kind: "pip"; code: string; suffix: string };

const CODE_PATTERN = /\{([^{}\s]{1,5})\}/g;
const KNOWN_INNER = /^(\d{1,2}|[XYZ]|[WUBRGC]|[TQSE]|[WUBRG]\/[WUBRG]|2\/[WUBRG]|[WUBRGC]\/P)$/;

/** Canonical brace code for an inner string the mana font knows, else null. */
export function canonicalPipCode(inner: string): string | null {
  const upper = inner.trim().toUpperCase();
  if (!KNOWN_INNER.test(upper)) return null;
  return `{${upper}}`;
}

/** Mana-font class suffix for a canonical code ("{W/U}" → "wu"), else null. */
export function pipSuffixForCode(code: string): string | null {
  const [token] = tokenize(code);
  if (!token || token.kind === "text") return null;
  return tokenSuffix(token);
}

export function splitPipRuns(text: string): PipRun[] {
  const out: PipRun[] = [];
  let cursor = 0;
  const pushText = (value: string) => {
    if (!value) return;
    const last = out[out.length - 1];
    if (last && last.kind === "text") last.value += value;
    else out.push({ kind: "text", value });
  };

  for (const match of text.matchAll(CODE_PATTERN)) {
    const index = match.index ?? 0;
    const code = canonicalPipCode(match[1]);
    const suffix = code ? pipSuffixForCode(code) : null;
    if (!code || !suffix) continue; // unknown code — stays literal
    pushText(text.slice(cursor, index));
    out.push({ kind: "pip", code, suffix });
    cursor = index + match[0].length;
  }
  pushText(text.slice(cursor));
  return out;
}

/** Inverse of splitPipRuns. */
export function joinPipRuns(runs: PipRun[]): string {
  return runs.map((run) => (run.kind === "pip" ? run.code : run.value)).join("");
}
