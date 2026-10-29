// Art-prompt safety ladder. The hosted FLUX API moderates prompts with an
// opaque filter ("Request Moderated" / "Content Moderated") and refuses the
// SAME prompt every time — so a retry that re-sent the designer's original
// art_prompt could never succeed (owner observation 2026-09-17:
// "regenerating cards rarely works"). Every attempt now sends a different
// prompt:
//
//   attempt 1 → the designer's prompt as written
//   attempt 2 → the same scene with NUDITY and SEXUAL words replaced by
//               clothed ones and a modest-dress suffix
//   attempt 3+ → a prompt built from the card's name, type line, colours and
//               style (no scene text at all)
//
// The owner's content policy (2026-10-28): VIOLENCE and dark themes are
// allowed in card art — blood, gore, demons, the undead, death are what a
// black or red card is made of, and the ladder no longer turns them into
// "crimson light" and "shadow spirits", nor tells the model the picture is
// "family-friendly… suitable for all ages". NUDITY stays blocked: rung 2
// still dresses a figure the prompt undressed, every prompt asks for fully
// clothed figures (FULLY_CLOTHED_LINE), and the generated picture is scanned
// for sexual content after it is stored (lib/ai/random-art.ts).
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

// A timeout is NOT a refusal (2026-10-28: every timed-out render was a slow
// provider whose picture arrived — lib/ai/image-gen.ts IMAGE_BUDGET_MS), so
// only a refusal the provider states moves to a softer prompt. A RETRY of a
// deck or `card` job step starts its ladder one prompt further down
// (artPromptLadder, by the step's attempt count); the creator's AI fill and
// the DFC back step start a NEW job on "try again", so they begin at the
// original prompt again.

/** Every art prompt carries this line (lib/ai/image-gen.ts adds it to the
 *  text-to-image AND the restyle prompt): phrased POSITIVELY on purpose —
 *  listing the forbidden things can trip the very classifier it is meant to
 *  pass, and a model paints the words it is given. CONDITIONAL on purpose
 *  (review of #644): "every figure is…" would invite figures into a land's
 *  or a landscape's picture. */
export const FULLY_CLOTHED_LINE = "If any figure appears, it is fully clothed.";

/** Rung 2's suffix (owner 2026-10-28: it replaced "Family-friendly stylized
 *  fantasy illustration, wholesome and serene, suitable for all ages", which
 *  softened every dark card into a calm one). Modest dress only — no word
 *  about violence or mood, and conditional like FULLY_CLOTHED_LINE. */
export const SAFE_ART_SUFFIX =
  "Tasteful fantasy illustration; any figure is fully clothed in armour, robes or garments.";

/** The words a "naked" is a person's next to (up to two words between:
 *  "a naked elven queen"). Anywhere else "naked" is a thing's — a naked
 *  blade, a naked flame — and reads "bare". */
const PERSON_WORDS =
  "(?:man|men|woman|women|person|people|figures?|body|bodies|torso|form|warriors?|maidens?|girls?|boys?|lady|ladies|nymphs?|" +
  "witch(?:es)?|queens?|kings?|goddess(?:es)?|gods?|elf|elves|dancers?|models?|priestess(?:es)?|sorceress(?:es)?|sirens?|" +
  "succubus|succubi|angels?|statues?|bathers?|youths?|heroes|heroine|hero|princess(?:es)?|princes?|vampires?|druids?|mermaids?|dryads?)";

/** The ONLY words the ladder still softens: nudity and sexual content, with
 *  clothed stand-ins. Whole-word, case-insensitive; simple plurals covered.
 *  Violence and dark-theme words are left as written (owner 2026-10-28). The
 *  child words stay (owner): they keep a minor out of any scene the filter
 *  refused (the scan's `sexual/minors` category is the one this guards). */
const SOFTEN_RULES: Array<[RegExp, string]> = [
  [/\b(lingerie|bikinis?|underwear|loincloths?)\b/gi, "flowing robes"],
  [/\bbare[- ]skin(?:ned)?\b/gi, "flowing garments"],
  // A person's "naked" is dressed; a thing's is bare (naked blade, flame).
  [new RegExp(`\\bnaked((?:\\s+[\\w-]+){0,2}?\\s+${PERSON_WORDS})\\b`, "gi"), "fully clothed$1"],
  [/\bnaked\b/gi, "bare"],
  [
    /\b(nude|nudes|nudity|topless|bare-chested|bare-breasted|shirtless|unclothed|unclad|undressed|disrobed|scantily[- ]clad|half-dressed)\b/gi,
    "fully clothed",
  ],
  [/\b(breasts?|buttocks|bosoms?)\b/gi, "garments"],
  // "revealing" only of clothing ("revealing the hidden door" is a verb).
  [/\b(skimpy|revealing(?=\s+(?:dress|dresses|outfits?|clothes|clothing|garb|attire|robes?|armou?r|costumes?|gowns?)\b))\b/gi, "modest"],
  [
    /\b(seductive(?:ly)?|sensual(?:ly)?|erotic(?:ally)?|sexy|sexual(?:ly)?|provocative(?:ly)?|lustful|lewd|nubile|busty|voluptuous|alluring|cleavage)\b/gi,
    "dignified",
  ],
  [/\b(children|child|kids?|infants?|babies|baby)\b/gi, "young apprentices"],
];

/** The designer's scene with its nudity / sexual words dressed + the modest
 *  suffix. Violence and dark words pass through untouched. */
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

/** A prompt with no scene text at all — the card's name and type rendered as
 *  symbolic, atmospheric fantasy art (its mood is the card's: no "serene" or
 *  "peaceful" since 2026-10-28). */
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
    "An atmospheric composition: a striking silhouette or emblem in a dramatic landscape.",
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
