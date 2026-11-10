import type { CollectionCard } from "./card-row";
import {
  ROLE_TARGETS,
  cardKey,
  cardThemes,
  commanderThemes,
  commanderTribes,
  creatureTypesOf,
  isBasicLand,
  isLand,
  roleOf,
  type DeckRole,
} from "./builder";

// ---------------------------------------------------------------------------
// How well a user's OWN cards support each commander they own (pure, tested;
// client-safe). The Collection Deck Builder's free "Best supported by your
// cards" sort, the build bar's numbers, and — later — the shortlist the AI's
// commander suggestions rank. Every number shown to the user comes from here,
// never from a model.
//
// The same reading of a card the drafter uses (lib/tools/collection/builder.ts):
// one card per NAME (any printing), legal in Commander, basics left out; its
// role (`roleOf`), its plan themes (`cardThemes`) and creature types. A card
// supports a commander when its colour identity sits inside the commander's.
//
//   * inColours — the non-land cards it could play;
//   * fit       — of those, the ones that play into ITS plan: a theme its
//                 rules text rewards (tokens, counters, sacrifice …) or a
//                 creature type its text names (a changeling is every
//                 type). Stricter than the drafter's soft weighting: a type
//                 that is only on its type line ("Human Advisor") and a
//                 theme that is only one of its own keywords ("Flying,
//                 lifelink") don't count — every Human or flyer would fit;
//   * roles     — ramp, card draw, removal and sweepers among them;
//   * lands     — the non-basic lands it could play;
//   * score     — 0–100: plan support (45 %), role coverage against the
//                 drafter's targets (35 %) and depth in its colours (20 %).
//
// Cards are grouped by colour-identity mask (32 of them) once, so a
// commander reads only the groups inside its colours.
// ---------------------------------------------------------------------------

/** What a score reads of a card (the columns `listScoringCards` selects). */
export type ScoringCard = Pick<CollectionCard, "name" | "typeLine" | "oracleText" | "colorIdentity" | "commanderLegal">;

export type ScoredRole = "ramp" | "draw" | "removal" | "wipe";

export type CommanderSupport = {
  /** Non-land cards you own in its colours (one per card name). */
  inColours: number;
  /** Of those, the ones that play into its plan. */
  fit: number;
  roles: Record<ScoredRole, number>;
  /** Non-basic lands you own in its colours. */
  lands: number;
  /** 0–100, for the sort (and the suggestions' shortlist). */
  score: number;
};

/** Plan cards past which more of them add nothing to the score. */
export const FIT_FULL = 30;
/** The 99 less its 36 lands: depth past this adds nothing. */
export const DEPTH_FULL = 63;
export const SCORE_WEIGHTS = { fit: 0.45, roles: 0.35, depth: 0.2 } as const;

const COLOUR_BIT: Record<string, number> = { W: 1, U: 2, B: 4, R: 8, G: 16 };

/** A colour identity as five bits (W U B R G); colourless is 0. */
export function identityMask(identity: readonly string[]): number {
  let mask = 0;
  for (const c of identity) mask |= COLOUR_BIT[c] ?? 0;
  return mask;
}

/** Plural and irregular creature-type words → the singular a type line uses. */
const IRREGULAR: Record<string, string> = {
  elves: "elf",
  dwarves: "dwarf",
  wolves: "wolf",
  werewolves: "werewolf",
  mice: "mouse",
  octopi: "octopus",
};

/** "Goblins" → goblin, "Allies" → ally, "Foxes" / "Sphinxes" → fox / sphinx. */
export function tribeKey(word: string): string {
  const w = word.toLowerCase();
  if (IRREGULAR[w]) return IRREGULAR[w];
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(x|ch|sh|ss|z)es$/.test(w)) return w.slice(0, -2);
  return w.length > 3 && w.endsWith("s") && !/(ss|us)$/.test(w) ? w.slice(0, -1) : w;
}

/** The words a text may name a creature type by: "goblin", "goblins";
 *  "ally", "allies"; "fox", "foxes"; "elf", "elves". */
function namesOf(key: string): string[] {
  const forms = [key, `${key}s`, `${key}es`];
  if (key.endsWith("y")) forms.push(`${key.slice(0, -1)}ies`);
  for (const [plural, one] of Object.entries(IRREGULAR)) if (one === key) forms.push(plural);
  return forms;
}

/** A keyword line ("Flying, vigilance, deathtouch, lifelink"; "First
 *  strike, haste"): words and commas, no sentence. */
const KEYWORD_LINE = /^[A-Za-z' -]+(?:, [A-Za-z' -]+)*$/;

function textOf(card: Pick<CollectionCard, "oracleText">): string {
  return (card.oracleText ?? "").replace(/\([^)]*\)/g, "");
}

/** What a commander's plan is, for the scores: the themes its rules text
 *  rewards (keyword lines left out) and the creature types its text names
 *  (as singular keys). */
export function scoringPlan(commander: Pick<CollectionCard, "typeLine" | "oracleText">): {
  themes: ReadonlySet<string>;
  tribes: readonly string[];
} {
  const text = textOf(commander);
  const rules = text
    .split("\n")
    .filter((line) => !KEYWORD_LINE.test(line.trim()))
    .join("\n");
  const themes = new Set(commanderThemes({ oracleText: rules }));
  const lower = text.toLowerCase();
  const words = new Set(lower.match(/[a-z][a-z'-]*/g) ?? []);
  const tribes = [...new Set(commanderTribes(commander).map(tribeKey))].filter((key) =>
    namesOf(key).some((form) => words.has(form)),
  );
  return { themes, tribes };
}

type Prepared = {
  key: string;
  land: boolean;
  role: DeckRole;
  themes: readonly string[];
  types: ReadonlySet<string>;
  changeling: boolean;
};

/** The cards grouped by identity mask (index 0–31), one per name, basics and
 *  cards not legal in Commander left out. */
export function prepareScoringCards(cards: readonly ScoringCard[]): Prepared[][] {
  const byMask: Prepared[][] = Array.from({ length: 32 }, () => []);
  const seen = new Set<string>();
  for (const card of cards) {
    if (!card.commanderLegal || isBasicLand(card)) continue;
    const key = cardKey(card.name);
    if (seen.has(key)) continue;
    seen.add(key);
    const land = isLand(card);
    byMask[identityMask(card.colorIdentity)].push({
      key,
      land,
      role: land ? "land" : roleOf(card),
      themes: land ? [] : cardThemes(card),
      types: new Set(creatureTypesOf(card)),
      changeling: /\bchangeling\b/i.test(card.oracleText ?? ""),
    });
  }
  return byMask;
}

export function scoreCommander(
  commander: Pick<CollectionCard, "name" | "typeLine" | "oracleText" | "colorIdentity">,
  prepared: Prepared[][],
): CommanderSupport {
  const own = cardKey(commander.name);
  const mask = identityMask(commander.colorIdentity);
  const { themes, tribes } = scoringPlan(commander);
  const roles: Record<ScoredRole, number> = { ramp: 0, draw: 0, removal: 0, wipe: 0 };
  let inColours = 0;
  let fit = 0;
  let lands = 0;
  for (let sub = 0; sub < 32; sub += 1) {
    if ((sub & ~mask) !== 0) continue;
    for (const card of prepared[sub]) {
      if (card.key === own) continue;
      if (card.land) {
        lands += 1;
        continue;
      }
      inColours += 1;
      if (card.role !== "core" && card.role !== "land") roles[card.role] += 1;
      const onTheme = card.themes.some((t) => themes.has(t));
      const onTribe = tribes.length > 0 && (card.changeling || tribes.some((t) => card.types.has(t)));
      if (onTheme || onTribe) fit += 1;
    }
  }
  const coverage =
    (Math.min(roles.ramp / ROLE_TARGETS.ramp, 1) +
      Math.min(roles.draw / ROLE_TARGETS.draw, 1) +
      Math.min(roles.removal / ROLE_TARGETS.removal, 1) +
      Math.min(roles.wipe / ROLE_TARGETS.wipe, 1)) /
    4;
  const score = Math.round(
    100 *
      (SCORE_WEIGHTS.fit * Math.min(fit / FIT_FULL, 1) +
        SCORE_WEIGHTS.roles * coverage +
        SCORE_WEIGHTS.depth * Math.min(inColours / DEPTH_FULL, 1)),
  );
  return { inColours, fit, roles, lands, score };
}

/** Every commander's support, by its collection row id. */
export function rankCommanders(
  commanders: readonly Pick<CollectionCard, "id" | "name" | "typeLine" | "oracleText" | "colorIdentity">[],
  cards: readonly ScoringCard[],
): Record<string, CommanderSupport> {
  const prepared = prepareScoringCards(cards);
  const out: Record<string, CommanderSupport> = {};
  for (const commander of commanders) out[commander.id] = scoreCommander(commander, prepared);
  return out;
}

/** "142 of your cards are in its colours · 31 fit its plan · ramp 9/10 …" */
export function describeSupport(support: CommanderSupport): string {
  return [
    `${support.inColours.toLocaleString("en-US")} of your cards ${support.inColours === 1 ? "is" : "are"} in its colours`,
    `${support.fit.toLocaleString("en-US")} fit its plan`,
    `ramp ${support.roles.ramp}/${ROLE_TARGETS.ramp}`,
    `card draw ${support.roles.draw}/${ROLE_TARGETS.draw}`,
    `removal ${support.roles.removal}/${ROLE_TARGETS.removal}`,
    `sweepers ${support.roles.wipe}/${ROLE_TARGETS.wipe}`,
  ].join(" · ");
}
