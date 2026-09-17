// Art-prompt safety ladder. The hosted FLUX API moderates prompts with an
// aggressive, opaque filter ("Request Moderated" / "Content Moderated") and
// refuses the SAME prompt every time — so a retry that re-sent the designer's
// original art_prompt could never succeed (owner observation 2026-09-17:
// "regenerating cards rarely works"). Every attempt now sends a different
// prompt:
//
//   attempt 1 → the designer's prompt as written
//   attempt 2 → the same scene with the usual trigger words softened and a
//               family-friendly suffix
//   attempt 3+ → a safe-by-construction prompt built from the card's name,
//               type line, colours and style (no scene text at all)
//
// Pure and client-safe; unit-tested.

export function isSafetyBlockError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("safety") ||
    lower.includes("moderat") ||
    lower.includes("nsfw") ||
    lower.includes("unsafe") ||
    lower.includes("blocked") ||
    lower.includes("prohibited") ||
    lower.includes("inappropriate") ||
    /content[ _-]?(policy|filter|violation)/.test(lower) ||
    (lower.includes("policy") && lower.includes("violat"))
  );
}

// Phrased POSITIVELY on purpose: listing the forbidden things ("no blood,
// no gore") can trip the very classifier this is meant to pass.
/** A moderated request through the gateway never comes back as a refusal
 *  — it hangs until our abort fires (probed 2026-09-17: the strictest-tier
 *  prompts all ended as timeouts). So a timeout is treated as a probable
 *  block and the next, safer rung is tried; a genuinely slow render simply
 *  gets a second chance with a tamer prompt. */
export function isTimeoutError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("timeout") || lower.includes("timed out") || lower.includes("aborted");
}

/** Errors worth answering with a reworded prompt. */
export function shouldRewordAfter(message: string): boolean {
  return isSafetyBlockError(message) || isTimeoutError(message);
}

export const SAFE_ART_SUFFIX =
  "Family-friendly stylized fantasy illustration, wholesome and serene, suitable for all ages.";

/** Words the moderation layer trips on most, with tamer stand-ins that keep
 *  the scene's mood. Whole-word, case-insensitive; simple plurals covered. */
const SOFTEN_RULES: Array<[RegExp, string]> = [
  [/\b(blood(?:y|ied|-soaked|soaked)?|bleeding|gore|gory|viscera|entrails|guts)\b/gi, "crimson light"],
  [/\b(corpses?|dead bod(?:y|ies)|carcass(?:es)?|cadavers?)\b/gi, "fallen statues"],
  [/\b(sever(?:ed|ing)|decapitat(?:ed|ion|ing)|behead(?:ed|ing)|dismember(?:ed|ing)|mutilat(?:ed|ion|ing)|flay(?:ed|ing)|impal(?:ed|ing)|disembowel(?:ed|ing))\b/gi, "shattered"],
  [/\b(skulls?)\b/gi, "carved masks"],
  [/\b(tortur(?:e|ed|ing)|agony|agonized|screaming in pain)\b/gi, "haunted"],
  [/\b(slaughter(?:ed|ing)?|massacre[ds]?|butcher(?:ed|ing)?|murder(?:ed|ing|s)?|kill(?:ed|ing|s)?|slay(?:ing|s)?|slain)\b/gi, "battle"],
  [/\b(naked|nude|nudity|topless|bare-chested|seductive|sensual|erotic)\b/gi, "robed"],
  [/\b(demons?|demonic|devils?|satanic|hellspawn)\b/gi, "shadow spirits"],
  [/\b(zombies?|undead|rotting|decaying|decayed)\b/gi, "ghostly"],
  [/\b(hang(?:ed|ing) (?:from|by) the neck|noose|gallows)\b/gi, "ruined tower"],
  [/\b(children|child|kids?|infants?|babies|baby)\b/gi, "young apprentices"],
  [/\b(suicide|self-harm|overdose)\b/gi, "despair"],
  [/\b(terrorist|hostage|execution|executioner)\b/gi, "sentinel"],
];

/** The designer's scene with trigger words softened + the safe suffix. */
export function softenArtPrompt(prompt: string): string {
  let out = prompt;
  for (const [pattern, replacement] of SOFTEN_RULES) {
    out = out.replace(pattern, replacement);
  }
  out = out.replace(/\s{2,}/g, " ").trim();
  return `${out} ${SAFE_ART_SUFFIX}`;
}

export type FallbackArtInputs = {
  title: string;
  /** e.g. "Legendary Creature — Dragon" or "Instant". */
  typeLine?: string | null;
  colors?: readonly string[] | null;
  style?: string | null;
};

const COLOR_MOOD: Record<string, string> = {
  white: "warm ivory and gold light",
  blue: "cool blue and silver light",
  black: "deep violet shadows and pale moonlight",
  red: "fiery orange and crimson light",
  green: "lush green and amber light",
  colorless: "muted steel and grey light",
  multicolor: "a rich, many-coloured palette",
};

/** A prompt that cannot trip the filter: no scene, no action — the card's
 *  name and type rendered as symbolic, atmospheric fantasy art. */
export function fallbackArtPrompt(input: FallbackArtInputs): string {
  const style = input.style?.trim()
    ? `Rendered strictly in ${input.style.trim()} style.`
    : "Painterly high-fantasy illustration style.";
  const palette = (input.colors ?? [])
    .map((c) => COLOR_MOOD[c])
    .filter(Boolean)
    .slice(0, 2)
    .join(" and ");
  return [
    `Symbolic fantasy trading-card illustration evoking "${input.title.trim() || "an unnamed card"}"${
      input.typeLine?.trim() ? `, a ${input.typeLine.trim()}` : ""
    }.`,
    "A serene, atmospheric composition: a striking silhouette or emblem in a dramatic landscape, calm and peaceful.",
    palette ? `Lit with ${palette}.` : "",
    style,
    SAFE_ART_SUFFIX,
    "NO frame, NO borders, NO card layout, NO text or lettering anywhere in the image.",
  ]
    .filter(Boolean)
    .join(" ");
}

/** The prompt to send on a given attempt (1-based). */
export function artPromptForAttempt(
  attempt: number,
  original: string,
  fallback: FallbackArtInputs,
): string {
  if (attempt <= 1) return original;
  if (attempt === 2) return softenArtPrompt(original);
  return fallbackArtPrompt(fallback);
}

/** The ladder from this attempt onward — the image call walks it when a
 *  prompt is refused, so one credit still buys the best available art. */
export function artPromptLadder(
  attempt: number,
  original: string,
  fallback: FallbackArtInputs,
): string[] {
  const start = Math.max(1, attempt);
  const out: string[] = [];
  for (let a = start; a <= 3; a += 1) out.push(artPromptForAttempt(a, original, fallback));
  if (out.length === 0) out.push(fallbackArtPrompt(fallback));
  return Array.from(new Set(out));
}
