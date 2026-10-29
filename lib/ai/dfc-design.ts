// ---------------------------------------------------------------------------
// Double-faced cards in the AI engine (the AI dialog redesign, PR 3) — the
// pure half: the four kinds and their front frames, the BACK FACE the model
// writes (its own name, cost, type line, rules, P/T, flavour, colour and its
// OWN art prompt), what the designer is told, the lint, the autofix and the
// plan-time fit — every gate the creator's save runs on a double-faced card,
// read here before any credit is reserved. No model call, no React, no
// Supabase (tests/unit/ai/dfc-design.test.ts).
//
// THE PRINTED SHAPES the rules follow:
//   • Transform (ISD … MOM): the front transforms into the back; the back
//     prints NO mana cost (withTransformBackShape) — a land back on the
//     transform land bodies is colourless (the import's rule, 5.4).
//   • Modal (ZNR, KHM, STX): either face is cast or played; each spell face
//     has its own cost, a land face none.
//   • The double-faced saga (NEO): a Saga on `sagadfcfront` whose last
//     chapter returns it transformed; its back is what it becomes, on the
//     body backBodyFor gives the back's type (the ▼ back for a creature).
//   • The double-sided token (Guild Kit, F17): two tokens back to back — the
//     back another token template in the front's design (tokenBackBodyFor).
//
// The bodies are never picked here by hand: the front by `bodyFor` (or the
// frame the maker picked, kept only where it dresses the design), the back by
// `creatorBackBodyFor` / `tokenBackBodyFor` — the creator's own functions —
// and then the server's ONE gate, `resolveDfcBackFace`, runs on the back as
// the creator will send it. Walker faces wait (owner Q2: no walker DFC body
// is published), and a battle stays out until its frame is published.
//
// Two pictures, two credits: the job paints the front and the back as two
// steps of one credit each (lib/ai/generation-jobs.ts).
// ---------------------------------------------------------------------------

import { z } from "zod";
import { colorWord } from "@/components/cards/frame-layer";
import {
  autofixCard,
  colorLettersFromWords,
  colorWordsFromLetters,
  deriveColorLetters,
  isNoCost,
  lintCardDesign,
  parseManaCost,
  withDrawableSymbols,
  type LintIssue,
  type LintableCard,
} from "@/lib/ai/mtg-rules";
import {
  autofixLayoutFront,
  autofixLayoutParts,
  layoutShapeRules,
  lintLayoutDesign,
  normalizeLayoutDesign,
  sagaRowProblems,
  type LayoutDesignCard,
} from "@/lib/ai/layout-design";
import { frameBrief, frameFitOf, frameMoveNotice } from "@/lib/ai/frame-brief";
import { supertypeHasWord } from "@/lib/cards/card-display";
import {
  DEFAULT_DFC_ICON,
  DFC_FACE_TYPES,
  bodyFor,
  colorlessFaceAllowed,
  dfcLookOf,
  namesSagaSubtype,
  type DfcLayout,
} from "@/lib/cards/dfc";
import { dfcFrontColorError, dfcFrontTypeError, resolveDfcBackFace } from "@/lib/cards/dfc-gate";
import { frameGateError, isFrameComboAvailable } from "@/lib/cards/frame-availability";
import { pickFrameColorKey } from "@/lib/cards/frame-color-key";
import { cardFieldsFace, frameKindGateError } from "@/lib/cards/frame-kind-gate";
import { isTokenPairFront } from "@/lib/cards/token-faces";
import { sagaFromRulesText } from "@/lib/cards/face-content";
import {
  FRAME_COLOR_KEYS,
  KIND_DEFS,
  framesForKind,
  kindHasAvailableFrame,
  sagaTwoFacesAvailable,
  type CardKind,
  type FrameChoice,
} from "@/lib/creator/card-kinds";
import { resolveGeneratedFrame } from "@/lib/creator/frame-random";
import { creatorBackBodyFor } from "@/lib/creator/saga-back";
import { tokenBackBodyFor } from "@/lib/creator/token-back";
import {
  COLOR_IDENTITY_VALUES,
  FRAME_TEMPLATE_LABELS,
  type CardType,
  type ColorIdentity,
  type FrameTemplate,
} from "@/types/card";

// ---------------------------------------------------------------------------
// The kinds
// ---------------------------------------------------------------------------

/** The double-faced kinds the AI dialog can make, in the creator's order. */
export const AI_DFC_KINDS = ["transform", "mdfc", "dfc_saga", "dfc_token"] as const;
export type AiDfcKind = (typeof AI_DFC_KINDS)[number];

export function isAiDfcKind(value: unknown): value is AiDfcKind {
  return typeof value === "string" && (AI_DFC_KINDS as readonly string[]).includes(value);
}

/** The dialog's chip words. */
export const DFC_KIND_LABELS: Readonly<Record<AiDfcKind, string>> = {
  transform: "Transform",
  mdfc: "Modal double-faced",
  dfc_saga: "Saga, two faces",
  dfc_token: "Token, two faces",
};

/** The creator kind each makes (a double-faced saga is the Saga kind on its
 *  double-faced front; a double-sided token the Token kind with its back on). */
export const DFC_CREATOR_KIND: Readonly<Record<AiDfcKind, CardKind>> = {
  transform: "transform",
  mdfc: "mdfc",
  dfc_saga: "saga",
  dfc_token: "token",
};

/** The double-faced layout of a kind (lib/cards/dfc.ts); a double-sided
 *  token is no DFC body — two tokens back to back. */
export function dfcLayoutOfKind(kind: AiDfcKind): DfcLayout | null {
  if (kind === "mdfc") return "modal";
  if (kind === "dfc_token") return null;
  return "transform";
}

/** The card types the FRONT may be (what the AI designs). */
export const DFC_FRONT_TYPES: Readonly<Record<AiDfcKind, readonly CardType[]>> = {
  transform: DFC_FACE_TYPES,
  mdfc: DFC_FACE_TYPES,
  dfc_saga: ["enchantment"],
  dfc_token: ["token"],
};

/** The card types the BACK may be: the wave-1 face types (no walker, saga or
 *  battle face), a token's back a token. */
export const DFC_BACK_TYPES: Readonly<Record<AiDfcKind, readonly CardType[]>> = {
  transform: DFC_FACE_TYPES,
  mdfc: DFC_FACE_TYPES,
  dfc_saga: DFC_FACE_TYPES,
  dfc_token: ["token"],
};

/** True when the kind's back prints a mana cost: a modal spell face only. */
export function backDrawsCost(kind: AiDfcKind, backType: string | null | undefined): boolean {
  return kind === "mdfc" && backType !== "land";
}

/** The template is one of the kind's FRONT frames. */
export function isDfcKindFront(kind: AiDfcKind, template: FrameTemplate | string | null | undefined): boolean {
  if (!template) return false;
  switch (kind) {
    case "transform":
    case "mdfc":
      return (KIND_DEFS[DFC_CREATOR_KIND[kind]].layoutTemplates ?? []).includes(template as FrameTemplate);
    case "dfc_saga":
      return template === "sagadfcfront";
    case "dfc_token":
      return isTokenPairFront(template);
  }
}

/** The kind's front frames as the creator's gallery lists them. */
export function dfcFrontChoices(kind: AiDfcKind, verifiedKeys: ReadonlySet<string>): FrameChoice[] {
  return framesForKind(DFC_CREATOR_KIND[kind], verifiedKeys).filter((choice) => isDfcKindFront(kind, choice.template));
}

/** Why the kind's chip is off, or null — the creator's own rules: a
 *  double-faced kind needs a front AND the default back published
 *  (kindHasAvailableFrame, sagaTwoFacesAvailable); a token pair a token
 *  frame (its back is another token template of the same design). */
export function dfcKindOffReason(kind: AiDfcKind, verifiedKeys: ReadonlySet<string>): string | null {
  const published =
    kind === "dfc_saga"
      ? sagaTwoFacesAvailable(verifiedKeys)
      : kind === "dfc_token"
        ? dfcFrontChoices(kind, verifiedKeys).some((choice) => choice.availableColorKeys.length > 0)
        : kindHasAvailableFrame(DFC_CREATOR_KIND[kind], verifiedKeys);
  return published ? null : "No frame published yet";
}

/** The front's card type the plan steers to, where the kind (or the frame
 *  picked) has one: a saga, a token, a land on the land front. */
export function dfcSteerType(kind: AiDfcKind, picked: FrameTemplate | null): CardType | undefined {
  if (kind === "dfc_saga") return "enchantment";
  if (kind === "dfc_token") return "token";
  if (picked && (picked === "m15dfclandfront" || picked === "m15mdfclandfront")) return "land";
  return undefined;
}

/** The front body a transform / modal card wears for its type, on the look
 *  of the frame picked (bordered by default) — bodyFor's answer. */
function dfcFrontBody(kind: AiDfcKind, cardType: CardType, picked: FrameTemplate | null): FrameTemplate | null {
  if (kind === "dfc_saga") return "sagadfcfront";
  const layout = dfcLayoutOfKind(kind);
  if (!layout) return null;
  return bodyFor(layout, "front", cardType, DEFAULT_DFC_ICON, picked ? dfcLookOf(picked) : "bordered");
}

/** The colour keys a card of the kind can be made in: its front (the frame
 *  picked, else the kind's default) AND its default back published there. */
export function dfcColorKeys(kind: AiDfcKind, picked: FrameTemplate | null, verifiedKeys: ReadonlySet<string>): string[] {
  if (kind === "dfc_token") {
    const keys = new Set<string>();
    for (const choice of dfcFrontChoices(kind, verifiedKeys)) {
      if (picked && choice.template !== picked) continue;
      for (const key of choice.availableColorKeys) keys.add(key);
    }
    return FRAME_COLOR_KEYS.filter((key) => keys.has(key));
  }
  const layout = dfcLayoutOfKind(kind)!;
  const front = picked ?? dfcFrontBody(kind, "creature", null);
  if (!front) return [];
  const back = bodyFor(layout, "back", "creature", DEFAULT_DFC_ICON, dfcLookOf(front));
  return FRAME_COLOR_KEYS.filter(
    (key) => isFrameComboAvailable(front, key, verifiedKeys) && (!back || isFrameComboAvailable(back, key, verifiedKeys)),
  );
}

/** The colours the designer's hint may take — never colourless on a
 *  double-faced body (a colourless face needs an Artifact word there). */
export function dfcColorHints(kind: AiDfcKind, picked: FrameTemplate | null, verifiedKeys: ReadonlySet<string>): ColorIdentity[] {
  const byKey: Record<string, ColorIdentity> = { w: "white", u: "blue", b: "black", r: "red", g: "green", c: "colorless", m: "multicolor" };
  return dfcColorKeys(kind, picked, verifiedKeys)
    .filter((key) => kind === "dfc_token" || key !== "c")
    .map((key) => byKey[key]!)
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// The design fields
// ---------------------------------------------------------------------------

const clamped = (max: number, min = 1) =>
  z
    .string()
    .min(min)
    .transform((value) => value.trim().slice(0, max));

/** A double-faced card's BACK face as the model writes it. */
export const backFaceDesignSchema = z
  .object({
    title: clamped(80).describe("The back face's own original name — never the front's."),
    cost: z
      .string()
      .max(40)
      .describe("Its curly-brace mana cost; '' where the back prints none (a transform back, a land, a token)."),
    card_type: z.enum(["creature", "artifact", "enchantment", "land", "instant", "sorcery", "token"]),
    supertype: clamped(64, 0).nullable().describe("Legendary etc. (a token's card types), or null."),
    subtypes: z
      .array(clamped(40, 0))
      .transform((values) => values.filter(Boolean).slice(0, 6))
      .describe("Subtypes, [] when none."),
    rules_text: clamped(600, 0).describe("The back face's templated rules text."),
    flavor_text: clamped(280, 0).nullable().describe("Short italic flavor, or null."),
    power: clamped(8, 0).nullable().describe("A creature back's power; else null."),
    toughness: clamped(8, 0).nullable(),
    color_identity: z
      .array(z.enum(COLOR_IDENTITY_VALUES))
      .max(6)
      .describe("The back face's own colors; [] when they are the front's."),
    art_prompt: clamped(600).describe(
      "The back face's OWN illustration prompt, 60-100 words: what THIS face shows. NO frame, NO text.",
    ),
  })
  .strict();

export type BackFaceDesign = z.infer<typeof backFaceDesignSchema>;

/** The design card's double-faced field (on top of the one-faced design). */
export type DfcDesignFields = { back_face?: BackFaceDesign | null };

/** The design as the double-faced code reads it. */
export type DfcDesignCard = LayoutDesignCard & DfcDesignFields & { flavor_text?: string | null };

// ---------------------------------------------------------------------------
// What the designer is told
// ---------------------------------------------------------------------------

/** The double-faced saga's reminder: it never sacrifices — its last chapter
 *  returns it transformed (NEO). */
export const DFC_SAGA_REMINDER = "(As this Saga enters and after your draw step, add a lore counter.)";
const DFC_SAGA_LAST_CHAPTER = "Exile this Saga, then return it to the battlefield transformed under your control.";

const backFields = (cost: string) =>
  `Write \`back_face\` — the BACK face, a card of its own: title (its OWN original name, never the front's), cost (${cost}), card_type, supertype, subtypes, rules_text, flavor_text (or null), power and toughness (a creature's; else null), color_identity (the back's own colors — [] when they are the front's) and art_prompt (the back face's OWN picture, 60–100 words: what this face shows — never the front's picture again).`;

const NO_WALKER_BACK =
  'The back is a creature, artifact, enchantment, land, instant or sorcery — never a planeswalker, saga or battle, and no "Saga" subtype.';

/** What the designer is told about the kind's shape (one paragraph). */
export function dfcShapeRules(kind: AiDfcKind, front: FrameTemplate | null): string {
  const landFront = front === "m15dfclandfront" || front === "m15mdfclandfront";
  const borderless = front !== null && dfcLookOf(front) === "borderless";
  const frontTypes = landFront
    ? 'card_type "land"'
    : 'card_type "creature", "artifact", "enchantment", "instant" or "sorcery" (never a land on this front)';
  switch (kind) {
    case "transform":
      return [
        "It is a TRANSFORM double-faced card: one card with two faces — it enters front face up and transforms into its back (a villager and the beast it becomes, a hero and the legend it grows into).",
        `The front is the card's own fields: ${frontTypes}; its rules_text says when it transforms ("…, transform it.").`,
        backFields('"" — a transform back has no mana cost'),
        NO_WALKER_BACK,
        borderless
          ? "The back is no land (a land face has no borderless frame)."
          : 'A land back is colorless (color_identity ["colorless"]).',
        "Each face: rules text under about 200 characters.",
      ].join(" ");
    case "mdfc":
      return [
        "It is a MODAL double-faced card: one card with two faces, and its owner casts or plays EITHER face (a spell on one side and a land on the other; two sides of one legend).",
        `The front is the card's own fields: ${frontTypes}, with its own mana cost${landFront ? " — a land has none (\"—\")" : ""}.`,
        backFields('its OWN curly-brace mana cost — a land back has none: ""'),
        NO_WALKER_BACK,
        borderless
          ? "The back is no land (a land face has no borderless frame)."
          : "A land back enters tapped or asks for life, taps for one color, and its color_identity is that color.",
        "Each face: rules text under about 200 characters.",
      ].join(" ");
    case "dfc_saga":
      return [
        layoutShapeRules("saga"),
        `It is a DOUBLE-FACED saga: its LAST chapter reads "${DFC_SAGA_LAST_CHAPTER}" and the back is what the story becomes; the saga's intro is null (the frame prints "${DFC_SAGA_REMINDER}").`,
        backFields('"" — the back has no mana cost'),
        `${NO_WALKER_BACK} It is usually a creature with power and toughness.`,
      ].join(" ");
    case "dfc_token":
      return [
        "It is a DOUBLE-SIDED TOKEN: two tokens printed back to back (a Goblin on one side, a Soldier on the other) — nothing transforms: each face is an ordinary token.",
        'The front is the card\'s own fields: card_type "token", cost "—", supertype its card types ("Creature", "Artifact"…).',
        backFields('"" — a token has no mana cost'),
        'The back is card_type "token" too: supertype its card types ("Creature", "Artifact Creature", "Artifact"…), its subtypes, its own short text, and power and toughness for a creature token. Its frame follows its own words and text, as the front\'s does.',
      ].join(" ");
  }
}

/**
 * The frame brief for a double-faced kind. `front`: the frame the maker
 * picked (null for Surprise me). `colorKeys`: the colours a FREE design is
 * held to; omit when the colour is pinned.
 */
export function dfcFrameBrief(kind: AiDfcKind, front: FrameTemplate | null, colorKeys?: readonly string[]): string {
  const parts: string[] = [];
  if (kind === "dfc_token" && front) {
    parts.push(frameBrief(front, "token"));
  } else {
    const shown = front ?? (kind === "dfc_saga" ? "sagadfcfront" : null);
    parts.push(
      shown
        ? `FRAME (the maker picked it — design the card FOR it): "${FRAME_TEMPLATE_LABELS[shown]}", the modern frame (2015 on).`
        : "FRAME: the modern double-faced frame (2015 on).",
    );
  }
  parts.push(dfcShapeRules(kind, front));
  if (colorKeys && colorKeys.length > 0 && !FRAME_COLOR_KEYS.every((key) => colorKeys.includes(key))) {
    parts.push(`Each face's color must be ${colorKeys.map(colorWord).join(" or ")} — the frame is published in no other.`);
  }
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Normalize, lint, autofix
// ---------------------------------------------------------------------------

/** The back's colour as the card holds it: its own, else the front's. */
export function resolvedBackColour(
  back: Pick<BackFaceDesign, "color_identity"> | null | undefined,
  front: readonly ColorIdentity[],
): ColorIdentity[] {
  return back?.color_identity && back.color_identity.length > 0 ? [...back.color_identity] : [...front];
}

/** The back as the one-faced lint and autofix read a card. */
function backAsCard(back: BackFaceDesign, frontColour: readonly ColorIdentity[]): LintableCard {
  return {
    title: back.title,
    cost: back.cost,
    card_type: back.card_type,
    supertype: back.supertype,
    subtypes: back.subtypes,
    color_identity: resolvedBackColour(back, frontColour),
    rules_text: back.rules_text,
    power: back.power,
    toughness: back.toughness,
    loyalty: null,
    defense: null,
  };
}

/**
 * Always, before the lint: the double-faced saga's reminder (it never
 * sacrifices) and its rules text written from its rows; a back with no
 * printed cost gets none; a transform LAND back goes colourless (the
 * transform land bodies' one colour, the import's rule); a token's back is a
 * token. Every other design: untouched.
 */
export function normalizeDfcDesign<T extends DfcDesignCard>(card: T, kind: AiDfcKind | undefined): T {
  if (!kind) return card;
  let out: T = card;
  if (kind === "dfc_saga") {
    const rows = card.saga ?? (() => {
      const parsed = sagaFromRulesText(card.rules_text);
      return parsed.chapters.length > 0 ? parsed : null;
    })();
    if (rows) {
      const intro = !rows.intro?.trim() || /^\(As this Saga enters/.test(rows.intro) ? DFC_SAGA_REMINDER : rows.intro;
      out = normalizeLayoutDesign({ ...out, saga: { intro, chapters: rows.chapters.map((row) => ({ ...row })) } }, "saga");
    }
  }
  const back = out.back_face;
  if (back) {
    const fixed = { ...back, subtypes: [...back.subtypes], color_identity: [...back.color_identity] };
    if (kind === "dfc_token") fixed.card_type = "token";
    if (!backDrawsCost(kind, fixed.card_type)) fixed.cost = "";
    if (dfcLayoutOfKind(kind) === "transform" && fixed.card_type === "land") fixed.color_identity = ["colorless"];
    out = { ...out, back_face: fixed };
  }
  return out;
}

const issue = (field: LintIssue["field"], message: string): LintIssue => ({ field, message });

/** The double-faced card's own errors and warnings (on top of the one-faced
 *  lint of its front). */
export function lintDfcDesign(card: DfcDesignCard, kind: AiDfcKind): { errors: LintIssue[]; warnings: LintIssue[] } {
  const errors: LintIssue[] = [];
  const warnings: LintIssue[] = [];
  if (kind === "dfc_saga") {
    const own = lintLayoutDesign(card, "saga");
    errors.push(...own.errors);
    warnings.push(...own.warnings);
  } else if (!DFC_FRONT_TYPES[kind].includes(card.card_type)) {
    errors.push(issue("rules_text", `A ${DFC_KIND_LABELS[kind]} card's front is ${DFC_FRONT_TYPES[kind].join(", ")}, never ${card.card_type}.`));
  }
  const back = card.back_face;
  if (!back) {
    errors.push(issue("rules_text", "A double-faced card needs its back_face."));
    return { errors, warnings };
  }
  if (!back.title.trim()) errors.push(issue("rules_text", "The back face needs its own name."));
  else if (back.title.trim().toLowerCase() === card.title.trim().toLowerCase()) {
    errors.push(issue("rules_text", "The back face needs a name of its own, not the front's."));
  }
  if (!DFC_BACK_TYPES[kind].includes(back.card_type)) {
    errors.push(issue("rules_text", `The back face is ${DFC_BACK_TYPES[kind].join(", ")}, never ${back.card_type}.`));
  }
  if (namesSagaSubtype(back.subtypes)) {
    errors.push(issue("supertype", 'The back face is no Saga here — drop the "Saga" subtype.'));
  }
  if (backDrawsCost(kind, back.card_type)) {
    if (parseManaCost(back.cost) === null) {
      errors.push(issue("cost", `The back face's mana cost "${back.cost}" isn't valid curly-brace notation.`));
    } else if (isNoCost(back.cost)) {
      errors.push(issue("cost", "A modal back face that is a spell needs its own mana cost."));
    }
  } else if (!isNoCost(back.cost)) {
    errors.push(issue("cost", 'This back face prints no mana cost — use "".'));
  }
  if (!back.rules_text.trim() && back.card_type !== "token" && back.card_type !== "creature") {
    errors.push(issue("rules_text", "The back face needs its rules text."));
  }
  // The one-faced rules on the back as a card of its own: its stats, its
  // symbols, its colour against them (the "no cost" question is answered
  // above).
  const lint = lintCardDesign(backAsCard(back, card.color_identity));
  const prefixed = (found: LintIssue) => ({ ...found, message: `The back face: ${found.message}` });
  errors.push(...lint.errors.filter((found) => found.field !== "cost" || backDrawsCost(kind, back.card_type)).map(prefixed));
  warnings.push(
    ...lint.warnings
      // (A back with no cost and no symbols takes its colour from the
      // front or its own pick — never a question for the judge.)
      .filter((found) => !(found.field === "cost" && /no mana cost/i.test(found.message)))
      .filter((found) => !(found.field === "color_identity" && /no colored mana symbols/i.test(found.message)))
      .map(prefixed),
  );
  // A colourless spell face needs an Artifact word on these bodies (D2).
  const colourKey = pickFrameColorKey(resolvedBackColour(back, card.color_identity));
  if (
    colourKey === "c" &&
    kind !== "dfc_token" &&
    back.card_type !== "land" &&
    back.card_type !== "artifact" &&
    !supertypeHasWord(back.supertype, "Artifact")
  ) {
    errors.push(issue("color_identity", 'A colorless back face needs "Artifact" on its type line — give it a color.'));
  }
  return { errors, warnings };
}

/** Pre-repair of the front, before the one-faced autofix: a type the kind
 *  can't take becomes its first one (a saga's its own shape). */
export function autofixDfcFront<T extends DfcDesignCard>(card: T, kind: AiDfcKind): T {
  if (kind === "dfc_saga") return autofixLayoutFront(card, "saga");
  if (DFC_FRONT_TYPES[kind].includes(card.card_type)) return card;
  return { ...card, card_type: DFC_FRONT_TYPES[kind][0]! };
}

/** Repair of the back after the one-faced autofix: its type, no Saga, its
 *  stats and symbols (the one-faced autofix on it), its cost per the kind,
 *  and its colour — kept where its symbols name none, a colourless spell
 *  face given the front's. Never a name invented. */
export function autofixDfcParts<T extends DfcDesignCard>(card: T, kind: AiDfcKind): T {
  let fixed: T = { ...card };
  if (kind === "dfc_saga") fixed = normalizeDfcDesign(autofixLayoutParts(fixed, "saga"), kind);
  const back = fixed.back_face;
  if (!back) return fixed;
  const part: BackFaceDesign = { ...back, subtypes: back.subtypes.filter((subtype) => subtype.trim().toLowerCase() !== "saga") };
  if (!DFC_BACK_TYPES[kind].includes(part.card_type)) part.card_type = DFC_BACK_TYPES[kind][0] as BackFaceDesign["card_type"];
  const repaired = autofixCard(backAsCard(part, fixed.color_identity));
  part.supertype = repaired.supertype ?? null;
  part.power = repaired.power;
  part.toughness = repaired.toughness;
  part.rules_text = repaired.rules_text;
  part.cost = backDrawsCost(kind, part.card_type) ? withDrawableSymbols(part.cost) : "";
  // The colour: the symbols the back uses where it names some, else its own
  // (or the front's) as written.
  const letters = deriveColorLetters(part.cost, part.rules_text);
  if (letters.length > 0) {
    const declared = new Set(colorLettersFromWords(resolvedBackColour(part, fixed.color_identity)));
    if (letters.some((letter) => !declared.has(letter))) part.color_identity = colorWordsFromLetters(letters);
  }
  if (
    kind !== "dfc_token" &&
    pickFrameColorKey(resolvedBackColour(part, fixed.color_identity)) === "c" &&
    part.card_type !== "land" &&
    part.card_type !== "artifact" &&
    !supertypeHasWord(part.supertype, "Artifact")
  ) {
    part.color_identity = [];
  }
  return normalizeDfcDesign({ ...fixed, back_face: part }, kind);
}

// ---------------------------------------------------------------------------
// The fit — every gate the creator's save runs, at plan time
// ---------------------------------------------------------------------------

/** The card as the creator will hold it once filled (the designed fields
 *  over the pinned ones). */
export type DfcFace = {
  card_type: CardType;
  supertype: string | null | undefined;
  subtypes: readonly string[] | undefined;
  title: string | null | undefined;
  cost: string | null | undefined;
  rules_text: string | null | undefined;
  flavor_text: string | null | undefined;
  color_identity: readonly ColorIdentity[];
  power: string | null | undefined;
  toughness: string | null | undefined;
  back_face: BackFaceDesign | null | undefined;
};

export type DfcFit = {
  ok: boolean;
  /** Why not, for the log and the redo. */
  reason: string | null;
  /** The front's template. */
  front: FrameTemplate | null;
  /** True when it is EXACTLY the frame picked (always, for Surprise me). */
  exact: boolean;
  /** Kept on another frame than the one picked: why, for the maker. */
  notice: string | null;
  /** The back's body and colour, as the gate stores them. */
  back: { template: FrameTemplate; color_identity: ColorIdentity[] } | null;
};

const article = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a");

/**
 * Whether the filled card saves as a double-faced card of the kind: the lint
 * (the front's shape, the saga's rows, the back), the front on its body (the
 * frame picked where it dresses the design, else the body its type takes —
 * kept and told), the front's gates (the kind gate, dfcFrontTypeError,
 * dfcFrontColorError, the published frame in its colour), the back's body
 * (the creator's own derivation) and the server's back gate on the back as
 * the creator sends it (its type, body, colour per colour, a transform back
 * with no cost). Pure: read by the plan before any credit is reserved, so no
 * save can be refused after the art.
 */
export function dfcFitOf(
  kind: AiDfcKind,
  face: DfcFace,
  verifiedKeys: ReadonlySet<string>,
  opts: { picked: FrameTemplate | null; random?: () => number },
): DfcFit {
  const no = (reason: string, front: FrameTemplate | null = null): DfcFit => ({ ok: false, reason, front, exact: false, notice: null, back: null });
  const saga = kind === "dfc_saga" ? sagaFromRulesText(face.rules_text) : null;
  const card: DfcDesignCard = {
    title: face.title ?? "",
    cost: face.cost ?? "",
    card_type: face.card_type,
    supertype: face.supertype ?? null,
    subtypes: [...(face.subtypes ?? [])],
    color_identity: [...face.color_identity],
    rules_text: face.rules_text ?? "",
    power: face.power?.trim() ? face.power : null,
    toughness: face.toughness?.trim() ? face.toughness : null,
    loyalty: null,
    defense: null,
    ...(saga ? { saga: { intro: saga.intro, chapters: saga.chapters } } : {}),
    back_face: face.back_face ?? null,
  };
  const lint = lintDfcDesign(card, kind);
  if (lint.errors.length > 0) return no(lint.errors.map((e) => e.message).join(" "));
  const colour = [...face.color_identity];
  const typeFace = {
    cardType: face.card_type,
    supertype: face.supertype ?? null,
    subtypes: face.subtypes ? [...face.subtypes] : undefined,
    title: face.title ?? null,
    rulesText: face.rules_text ?? null,
    flavorText: face.flavor_text ?? null,
    power: face.power ?? null,
    toughness: face.toughness ?? null,
  };

  // ---- The front's frame ----
  let front: FrameTemplate | null;
  let notice: string | null = null;
  if (kind === "dfc_token") {
    if (opts.picked) {
      const fit = frameFitOf({ template: opts.picked, cardType: "token", colorIdentity: colour, verifiedKeys, face: typeFace });
      front = fit.frame;
      notice = fit.notice;
    } else {
      front = resolveGeneratedFrame({
        cardType: "token",
        requested: "random",
        colorIdentity: colour,
        verifiedKeys,
        face: typeFace,
        ...(opts.random ? { random: opts.random } : {}),
      });
    }
    if (!front || !isTokenPairFront(front)) return no("No token frame published in the card's color dresses this token.");
  } else {
    front = dfcFrontBody(kind, face.card_type, opts.picked);
    if (!front) return no(`No ${DFC_KIND_LABELS[kind]} front frame dresses a ${face.card_type} on this look.`);
    if (opts.picked && front !== opts.picked) {
      notice = `Designed as ${article(face.card_type)} ${face.card_type}, so it's on ${FRAME_TEMPLATE_LABELS[front]}.`;
    }
  }
  const exact = !opts.picked || front === opts.picked;
  if (opts.picked && !exact && !notice) notice = frameMoveNotice({ picked: opts.picked, landed: front, cardType: face.card_type });

  // ---- The front's gates ----
  const kindError = frameKindGateError(
    front,
    cardFieldsFace({ card_type: face.card_type, supertype: face.supertype, subtypes: face.subtypes, title: face.title, rules_text: face.rules_text }),
  );
  if (kindError) return no(kindError, front);
  const typeError = dfcFrontTypeError(front, face.card_type);
  if (typeError) return no(typeError, front);
  const colourError = dfcFrontColorError(front, { cardType: face.card_type, supertype: face.supertype ?? null }, colour);
  if (colourError) return no(colourError, front);
  const gate = frameGateError(front, colour, verifiedKeys);
  if (gate) return no(gate, front);

  // ---- The back: its body (the creator's derivation) and the server's gate ----
  const back = face.back_face!;
  const backColour = resolvedBackColour(back, colour);
  const layout = dfcLayoutOfKind(kind);
  const backTemplate = layout
    ? creatorBackBodyFor({
        mode: "create",
        layout,
        backType: back.card_type,
        backSubtypes: back.subtypes,
        family: DEFAULT_DFC_ICON,
        look: dfcLookOf(front),
        backColorIdentity: back.color_identity,
        frontColorIdentity: colour,
        verifiedKeys,
      })
    : tokenBackBodyFor(
        front,
        {
          supertype: back.supertype,
          subtypes: back.subtypes,
          rulesText: back.rules_text,
          flavorText: back.flavor_text,
          power: back.power,
          toughness: back.toughness,
          colorIdentity: backColour,
        },
        verifiedKeys,
      );
  if (!backTemplate) return no(`No back-face frame exists for ${article(back.card_type)} ${back.card_type} back on this frame yet.`, front);
  if (pickFrameColorKey(backColour) === "c" && !colorlessFaceAllowed(backTemplate, { cardType: back.card_type, supertype: back.supertype })) {
    return no('A colorless back face needs "Artifact" on its type line.', front);
  }
  const resolved = resolveDfcBackFace({
    frontTemplate: front,
    back: {
      title: back.title,
      ...(backDrawsCost(kind, back.card_type) ? { cost: back.cost } : {}),
      card_type: back.card_type,
      supertype: back.supertype,
      subtypes: [...back.subtypes],
      rules_text: back.rules_text,
      flavor_text: back.flavor_text,
      power: back.power,
      toughness: back.toughness,
      frame_style: { template: backTemplate },
      color_identity: backColour,
    },
    family: layout === "transform" ? DEFAULT_DFC_ICON : undefined,
    frontColorIdentity: colour,
    verifiedKeys,
  });
  if (!resolved.ok) return no(resolved.message, front);
  return { ok: true, reason: null, front, exact, notice, back: { template: backTemplate, color_identity: backColour } };
}

// ---------------------------------------------------------------------------
// Before any model call, and the fill
// ---------------------------------------------------------------------------

/**
 * Why a fill must be refused BEFORE any model call, or null: a kept colour
 * no front of the kind is published in; a double-faced saga's kept rules
 * text that is no saga's chapters (the designer may not touch it).
 */
export function dfcPrecheckError(input: {
  kind: AiDfcKind;
  picked: FrameTemplate | null;
  want: readonly string[];
  lockedRules: string | null | undefined;
  lockedColors: readonly ColorIdentity[] | null | undefined;
  verifiedKeys: ReadonlySet<string>;
}): string | null {
  const { kind, want, verifiedKeys } = input;
  if (kind === "dfc_saga" && !want.includes("rules_text")) {
    const problems = sagaRowProblems(sagaFromRulesText(input.lockedRules));
    if (problems.length > 0) {
      return `The rules text you kept can't be a saga's chapters — ${problems[0]} Tick Rules text so the AI writes them, or write them as "I — …", "II — …". No credits were used.`;
    }
  }
  if (!want.includes("color_identity") && input.lockedColors && input.lockedColors.length > 0 && verifiedKeys.size > 0) {
    const key = pickFrameColorKey([...input.lockedColors]);
    if (!dfcColorKeys(kind, input.picked, verifiedKeys).includes(key)) {
      return `The ${DFC_KIND_LABELS[kind]} frames aren't published in ${colorWord(key)} yet. Tick Colors so the AI picks one they are, or pick another kind. No credits were used.`;
    }
  }
  return null;
}

/** The pins a double-faced fill reads: the front's stats only where its kind
 *  may draw them (never on a saga), never loyalty or defense (no walker or
 *  battle face), and never a second part's (a back is designed whole). */
export function dfcLockedOf<T extends { power?: string; toughness?: string; loyalty?: string; defense?: string; back_face?: unknown }>(
  locked: T,
  kind: AiDfcKind,
): T {
  const { loyalty: _loyalty, defense: _defense, back_face: _back, ...rest } = locked;
  void _loyalty;
  void _defense;
  void _back;
  if (kind !== "dfc_saga") return rest as T;
  const { power: _power, toughness: _toughness, ...saga } = rest;
  void _power;
  void _toughness;
  return saga as T;
}

/** A double-faced card's back as the fill hands it to the creator: every
 *  `back_face.*` field the back draws (its picture arrives with the back's
 *  step), its colour explicit — the back is designed whole. */
export type FillBackFace = {
  title: string;
  cost: string;
  card_type: CardType;
  supertype: string | null;
  subtypes: string[];
  rules_text: string;
  flavor_text: string | null;
  power: string | null;
  toughness: string | null;
  color_identity: ColorIdentity[];
};

export function fillBackFaceOf(kind: AiDfcKind, back: BackFaceDesign, backColour: readonly ColorIdentity[]): FillBackFace {
  return {
    title: back.title,
    cost: backDrawsCost(kind, back.card_type) ? back.cost : "",
    card_type: back.card_type,
    supertype: back.supertype,
    subtypes: [...back.subtypes],
    rules_text: back.rules_text,
    flavor_text: back.flavor_text,
    power: back.power,
    toughness: back.toughness,
    color_identity: [...backColour],
  };
}

/** The credits a fill takes: one per picture painted (two for a
 *  double-faced kind with the artwork ticked), else one — what the dialog
 *  and the confirm say before anyone pays. */
export function fillCreditsFor(designKind: unknown, want: readonly string[]): number {
  return isAiDfcKind(designKind) && want.includes("card_type") && want.includes("art") ? 2 : 1;
}
