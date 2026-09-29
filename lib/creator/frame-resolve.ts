import {
  FRAME_ERA_LABELS,
  FRAME_SET_ERA,
  FRAME_SET_LABELS,
  FRAME_TEMPLATE_LABELS,
  FRAME_TEMPLATE_SET,
  DEFAULT_FRAME_TEMPLATE,
  type CardType,
  type ColorIdentity,
  type FrameTemplate,
} from "@/types/card";
import { isFrameComboAvailable } from "@/lib/cards/frame-availability";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import {
  colorWord,
  isArtifactFrameType,
  pickFrameColorKey,
} from "@/components/cards/frame-layer";
import type { FrameMatch } from "@/lib/scryfall/frame-signatures";
import { eraForTemplate, standardFrameFor } from "@/lib/creator/frame-picker";
import {
  KIND_DEFS,
  baseFrameFor,
  framesForKind,
  importedCardTypeForKind,
  isBorrowedVariation,
  isTypeWordDress,
  kindFromCard,
  templateIsBasicOnly,
  type CardKind,
  type FrameColorKey,
} from "@/lib/creator/card-kinds";

// ---------------------------------------------------------------------------
// One resolver for every programmatic frame write in the creator — kind
// changes, Scryfall imports, AI fills and the frame tiles. Each caller
// hands in the template(s) it would LIKE, in preference order, plus the
// colour the card renders with; the resolver answers with a published
// (template, colour) pair and says what it had to change, so the caller can
// tell the user instead of substituting silently.
//
// Two policies, because the caller knows what the user meant:
//   • "frame"  — the COLOUR is the fixed fact (an imported blue card is
//     blue; the user picked blue): keep the colour and find a published
//     frame for the kind, walking the candidates first.
//   • "colour" — the FRAME is the fixed fact (the user clicked this tile):
//     keep the frame and move to a colour it is published in.
//
// Pure, React-free, verification-aware — the same
// isFrameComboAvailable gate the picker uses.
// ---------------------------------------------------------------------------

export type FrameResolution =
  | { status: "exact"; template: FrameTemplate; colorKey: FrameColorKey }
  | {
      status: "frame-switched";
      template: FrameTemplate;
      colorKey: FrameColorKey;
      /** The frame the caller wanted (candidates[0]). */
      fromTemplate: FrameTemplate;
    }
  | {
      status: "colour-switched";
      template: FrameTemplate;
      colorKey: FrameColorKey;
      fromColorKey: FrameColorKey;
    }
  | { status: "unavailable" };

export type ResolveFrameInput = {
  kind: CardKind;
  /** Templates the caller would accept, most wanted first. */
  candidates: readonly FrameTemplate[];
  colorKey: FrameColorKey;
  verifiedKeys: ReadonlySet<string>;
  prefer: "frame" | "colour";
};

export function resolvePublishedFrame(input: ResolveFrameInput): FrameResolution {
  const { kind, candidates, colorKey, verifiedKeys, prefer } = input;
  const wanted = candidates[0];
  if (!wanted) return { status: "unavailable" };

  const available = (template: FrameTemplate, key: FrameColorKey) =>
    isFrameComboAvailable(template, key, verifiedKeys);

  // The wanted frame in the wanted colour needs no change at all.
  if (available(wanted, colorKey)) {
    return { status: "exact", template: wanted, colorKey };
  }

  const gallery = framesForKind(kind, verifiedKeys);
  const firstColourOf = (template: FrameTemplate): FrameColorKey | null =>
    gallery.find((choice) => choice.template === template)
      ?.availableColorKeys[0] ?? null;

  const keepColour = (): FrameResolution | null => {
    for (const candidate of candidates.slice(1)) {
      if (available(candidate, colorKey)) {
        return {
          status: "frame-switched",
          template: candidate,
          colorKey,
          fromTemplate: wanted,
        };
      }
    }
    // A basic-only frame (the full-art basic land) is never a stand-in: it
    // can't draw most cards of its kind, so it is reachable only as an
    // explicit candidate (TODO 0.26). Nor is a frame the kind borrows from
    // another type (the artifact frame on a creature, TODO 1.7; the Nyx
    // showcase, owner decision A3): it would dress a plain creature as an
    // artifact or an enchantment. Nor is a frame the kind wears by type word
    // (the artifact token frame, TODO 3b.15): the words pick it, never a
    // fallback.
    const any = gallery.find(
      (choice) =>
        !templateIsBasicOnly(choice.template) &&
        !isBorrowedVariation(kind, choice.template) &&
        !isTypeWordDress(kind, choice.template) &&
        choice.availableColorKeys.includes(colorKey),
    );
    return any
      ? {
          status: "frame-switched",
          template: any.template,
          colorKey,
          fromTemplate: wanted,
        }
      : null;
  };

  const keepFrame = (): FrameResolution | null => {
    for (const candidate of candidates) {
      const key = firstColourOf(candidate);
      if (key) {
        return candidate === wanted
          ? {
              status: "colour-switched",
              template: candidate,
              colorKey: key,
              fromColorKey: colorKey,
            }
          : {
              status: "frame-switched",
              template: candidate,
              colorKey: key,
              fromTemplate: wanted,
            };
      }
    }
    return null;
  };

  const ordered = prefer === "frame" ? [keepColour, keepFrame] : [keepFrame, keepColour];
  for (const attempt of ordered) {
    const result = attempt();
    if (result) return result;
  }
  return { status: "unavailable" };
}

/** The textless token frame a text-box token frame falls back to while it
 *  isn't published in the card's colour (TODO 4.49 (b)): the same arch and
 *  artifact dress, the text on the scrim as before — never the plain token
 *  frame for a Treasure. */
const TEXT_BOX_TOKEN_FALLBACK: Partial<Record<FrameTemplate, FrameTemplate>> = {
  m15tokentext: "m15token",
  m15tokenartifacttext: "m15tokenartifact",
};

/** The frames a Scryfall import asks resolvePublishedFrame for, most wanted
 *  first: the printing's own frame (a text-box token's textless dress next,
 *  TEXT_BOX_TOKEN_FALLBACK), its era's standard for the card type, then the
 *  M15 standard. An Artifact Creature asks for M15's artifact frame before
 *  the plain one (TODO 1.7), so a Juggernaut whose Alpha frame isn't
 *  published falls forward to the artifact card it is, not a grey spell. */
export function importFrameCandidates(input: {
  wanted: FrameTemplate;
  cardType: CardType;
  supertype?: string | null;
}): FrameTemplate[] {
  const { wanted, cardType, supertype } = input;
  const artifactCreature =
    cardType === "creature" && isArtifactFrameType({ cardType, supertype });
  return Array.from(
    new Set(
      [
        wanted,
        TEXT_BOX_TOKEN_FALLBACK[wanted] ?? null,
        standardFrameFor(eraForTemplate(wanted), cardType),
        artifactCreature ? ("m15artifact" as const) : null,
        standardFrameFor("m15", cardType),
      ].filter((t): t is FrameTemplate => Boolean(t)),
    ),
  );
}

/**
 * Where a Scryfall import lands (the creator's handleScryfallImport, after
 * the imported kind is applied): the printing's frame, resolved with the
 * "frame" policy for the IMPORTED colour, which is a fact about the card and
 * never changes — the printing's frame, else its era's standard, else (for
 * an Artifact Creature) the M15 artifact frame, else the M15 standard, else
 * any published frame of the kind in that colour (importFrameCandidates).
 * `current` is the form after the kind change, for what an older cached
 * patch doesn't carry. Pure, so the form's wiring is the tested path.
 */
export function resolveImportFrame(input: {
  patch: {
    frame_template?: FrameTemplate;
    /** The signature registry's match (TODO 1.4). When present, the import
     *  wants `landOn ?? template` — the same frame `frame_template` names
     *  on a fresh patch; an older cached patch without it keeps
     *  `frame_template`. A rejected printing (a substitute card) wants
     *  nothing of its own. */
    frame_match?: Pick<FrameMatch, "template" | "landOn" | "reject">;
    card_type?: CardType;
    supertype?: string;
    color_identity?: readonly ColorIdentity[];
  };
  /** The imported kind (patch.kind, else the card type's). */
  kind: CardKind | null;
  current: {
    template?: FrameTemplate | null;
    cardType?: CardType | null;
    colors: readonly ColorIdentity[];
  };
  verifiedKeys: ReadonlySet<string>;
}): { wanted: FrameTemplate; colorKey: FrameColorKey; resolution: FrameResolution } {
  const { patch, current } = input;
  const colorKey = pickFrameColorKey(
    patch.color_identity ?? current.colors,
  ) as FrameColorKey;
  const cardType = patch.card_type || current.cardType || "creature";
  const matched =
    patch.frame_match && !patch.frame_match.reject
      ? (patch.frame_match.landOn ?? patch.frame_match.template)
      : undefined;
  const wanted =
    matched ?? patch.frame_template ?? current.template ?? DEFAULT_FRAME_TEMPLATE;
  const resolution = resolvePublishedFrame({
    kind: input.kind ?? kindFromCard(cardType, undefined),
    candidates: importFrameCandidates({
      wanted,
      cardType,
      supertype: patch.supertype,
    }),
    colorKey,
    verifiedKeys: input.verifiedKeys,
    prefer: "frame",
  });
  return { wanted, colorKey, resolution };
}

/**
 * Finalize a static frame match (the signature registry, TODO 1.4) against
 * the verified combos:
 *   • a match that names another frame once it is verified
 *     (`onceVerified`: a 2003-frame textless promo names the 2003 frame
 *     until the textless frame is verified in its colour, owner decision
 *     A9) takes that frame when it is — and, when the registry says what
 *     the match is then (`onceVerifiedMatch`: an M20+ token is exact on its
 *     full-art template, TODO 4.48, or nearest for a gap it doesn't draw),
 *     that status, reason, item and gaps — and while it isn't verified, a
 *     match that would then be exact says "not yet verified" and is marked
 *     `unverified`, the stand-in still its landing;
 *   • `exact` only when PipGlyph's frame is verified in the card's colour —
 *     an unverified frame is never an exact match to a user, so it becomes
 *     `nearest`, "not yet verified in <colour>", marked `unverified` (the
 *     frame request log's "Not yet verified" cause, TODO 1.6 D1).
 * Nearest and unsupported matches otherwise pass through unchanged. Pure.
 */
export function withVerification<
  T extends Pick<FrameMatch, "status" | "template" | "reason"> &
    Partial<Pick<FrameMatch, "onceVerified" | "onceVerifiedMatch" | "unverified" | "blockedBy" | "gaps">>,
>(match: T, colorKey: string, verifiedKeys: ReadonlySet<string>): T {
  let finalized = match;
  if (match.onceVerified && verifiedKeys.has(frameComboKey(match.onceVerified, colorKey))) {
    const { onceVerified, onceVerifiedMatch, ...rest } = match;
    if (onceVerifiedMatch) {
      // The M20 token design (TODO 4.48): exact on its own verified frame,
      // or nearest for a gap it doesn't draw either — with that gap's
      // reason, item and gaps, never the stand-in's.
      const base: Partial<FrameMatch> = { ...rest };
      delete base.blockedBy;
      delete base.gaps;
      finalized = {
        ...base,
        template: onceVerified,
        status: onceVerifiedMatch.status,
        reason: onceVerifiedMatch.reason,
        ...(onceVerifiedMatch.blockedBy ? { blockedBy: onceVerifiedMatch.blockedBy } : {}),
        ...(onceVerifiedMatch.gaps ? { gaps: onceVerifiedMatch.gaps } : {}),
      } as unknown as T;
    } else {
      finalized = { ...rest, template: onceVerified } as unknown as T;
    }
  } else if (match.onceVerified && match.onceVerifiedMatch?.status === "exact" && match.status !== "exact") {
    // The frame the printing wears exists and would be exact, but isn't
    // verified in the card's colour yet (the M20 token design before its
    // tick): the stand-in keeps the landing, and the answer says what's
    // left — "not yet verified", filed under the request log's "Not yet
    // verified" (TODO 1.6, D1) like any unverified exact frame.
    const base: Partial<FrameMatch> = { ...match };
    delete base.blockedBy;
    return {
      ...base,
      reason: `not yet verified in ${colorWord(colorKey)}`,
      unverified: true,
    } as unknown as T;
  }
  if (finalized.status !== "exact") return finalized;
  if (verifiedKeys.has(frameComboKey(finalized.template, colorKey))) return finalized;
  return {
    ...finalized,
    status: "nearest",
    reason: `not yet verified in ${colorWord(colorKey)}`,
    // The frame request log's cause (TODO 1.6, D1): the frame exists, it
    // only waits for verification — a nearest answer can't say that alone.
    unverified: true,
  };
}

/**
 * An import patch with its frame match finalized (withVerification, in the
 * patch's own colour) — what /api/scryfall/named returns. `frame_template`
 * follows the finalized match (`landOn ?? template`) when the match took
 * another frame, as the mapper wrote it from the static one; a patch
 * without a match, or a layout kind's (no frame_template), keeps its own.
 * Pure: returns a new patch.
 */
export function finalizeImportMatch<
  P extends {
    frame_match?: FrameMatch;
    frame_template?: FrameTemplate;
    color_identity?: readonly ColorIdentity[];
  },
>(patch: P, verifiedKeys: ReadonlySet<string>): P {
  if (!patch.frame_match) return patch;
  const match = withVerification(
    patch.frame_match,
    pickFrameColorKey(patch.color_identity),
    verifiedKeys,
  );
  const moved =
    patch.frame_template !== undefined && match.template !== patch.frame_match.template;
  return {
    ...patch,
    frame_match: match,
    ...(moved ? { frame_template: match.landOn ?? match.template } : {}),
  };
}

/** The AI deck remix's step error when no frame is published in the card's
 *  colour (TODO 1.22) — said plainly instead of the save's frame gate. */
export const REMIX_FRAME_UNAVAILABLE = "No published frame for this card's colour yet.";

export type RemixFrame =
  | {
      ok: true;
      template: FrameTemplate;
      /** Undefined only when the printing has no card type PipGlyph models
       *  (the mapper found no kind either) — never invented. */
      card_type: CardType | undefined;
    }
  | { ok: false; error: string };

/**
 * Where an AI deck remix of a Scryfall printing lands (TODO 1.22) — the
 * creator import's rules, without a form: the remix saves the mechanics of a
 * real printing on a new card, so it must pass the same published-frame gate
 * the save checks (frameGateError), in the card's own colour, which it never
 * changes.
 *   • A layout kind (saga, adventure, split, aftermath, flip) lands on its
 *     layout template with the printed card type the template can draw
 *     (importedCardTypeForKind, TODO 1.21). When that template isn't
 *     published in the colour, the card prints on its card type's standard
 *     frame, as the creator import does — a remixed Bonecrusher Giant is a
 *     creature on M15 while the adventure frame is unpublished.
 *   • A standard kind resolves like the creator import (resolveImportFrame):
 *     the printing's frame, its era's standard, M15's artifact frame for an
 *     Artifact Creature, the kind's M15 standard, then any published frame
 *     of the kind in the colour. Juggernaut LEA #255 lands on agclassic where
 *     it is verified and on m15artifact otherwise; Seat of the Synod MRD
 *     #283 and Command Tower C13 #281 on modernland, else m15land.
 *   • Nothing published in the colour → { ok: false } with
 *     REMIX_FRAME_UNAVAILABLE (a colour switch counts: the remix never
 *     recolours a card).
 * Pure, so the remix step's frame choice is the tested path. The remix
 * doesn't log a frame request (TODO 1.6) — a follow-up.
 */
export function remixFrameFor(
  patch: {
    kind?: CardKind;
    frame_template?: FrameTemplate;
    card_type?: CardType;
    supertype?: string;
    color_identity?: readonly ColorIdentity[];
  },
  verifiedKeys: ReadonlySet<string>,
): RemixFrame {
  // A printing with no modelled card type (the mapper found neither) keeps
  // none; its frame resolves as a creature's, which is the default frame.
  const known = Boolean(patch.kind || patch.card_type);
  const kind = patch.kind ?? kindFromCard(patch.card_type, undefined);
  const cardType = importedCardTypeForKind(kind, patch.card_type);
  const savedType = known ? cardType : undefined;
  const colors: readonly ColorIdentity[] = patch.color_identity ?? ["colorless"];
  const layoutTemplate = KIND_DEFS[kind].layoutTemplates?.[0];

  if (layoutTemplate) {
    const colorKey = pickFrameColorKey([...colors]);
    if (isFrameComboAvailable(layoutTemplate, colorKey, verifiedKeys)) {
      return { ok: true, template: layoutTemplate, card_type: savedType };
    }
  }

  // A standard kind, or a layout kind whose template isn't published in the
  // colour: the card type's frames, from the printing's own (a layout kind
  // has none) down to the M15 standard.
  const standardKind = layoutTemplate ? kindFromCard(cardType, undefined) : kind;
  const { colorKey, resolution } = resolveImportFrame({
    patch: {
      frame_template: layoutTemplate ? undefined : patch.frame_template,
      card_type: cardType,
      supertype: patch.supertype,
      color_identity: colors,
    },
    kind: standardKind,
    current: {
      template: standardFrameFor("m15", cardType) ?? DEFAULT_FRAME_TEMPLATE,
      cardType,
      colors,
    },
    verifiedKeys,
  });
  // Only a landing in the card's OWN colour saves: when nothing of the kind
  // is published in it, the resolver's last resort is a candidate frame in
  // another colour — reported as "frame-switched" too, but with that other
  // colour's key — and the save's frame gate would refuse it after the art
  // was already paid for.
  if (
    (resolution.status === "exact" || resolution.status === "frame-switched") &&
    resolution.colorKey === colorKey
  ) {
    return { ok: true, template: resolution.template, card_type: savedType };
  }
  return { ok: false, error: REMIX_FRAME_UNAVAILABLE };
}

/** Where a card on a basic-only frame (the full-art basic land) goes when it
 *  stops being one basic land — Land type → Nonbasic, or a rename that
 *  clears the basic seed: the land frame that frame is a variation of, in
 *  the card's colour (else any other published land frame in that colour).
 *  Null when the template isn't basic-only, or nothing is published in that
 *  colour — the chip's disabled reason and the server's refusal then say
 *  why. The caller announces the switch (TODO 0.26: no silent swaps). */
export function basicOnlyFrameFallback(
  template: FrameTemplate,
  colorKey: FrameColorKey,
  verifiedKeys: ReadonlySet<string>,
): FrameTemplate | null {
  if (!templateIsBasicOnly(template)) return null;
  const resolution = resolvePublishedFrame({
    kind: "land",
    candidates: [baseFrameFor("land", template)],
    colorKey,
    verifiedKeys,
    prefer: "frame",
  });
  // Never recolour the card for this: a colour switch or nothing published
  // leaves the frame where it is.
  return resolution.status === "exact" || resolution.status === "frame-switched"
    ? resolution.template
    : null;
}

/** A frame's label with its frame set in front: "Tarkir: Dragonstorm —
 *  Draconic". Template labels are usually set-relative, so the set is
 *  prepended. A label that already names its set, such as "Dragon Wing
 *  (Multiverse Legends)", is returned unchanged so the set isn't printed
 *  twice. Used by the showcase chips and the Variations summary. */
export function setQualifiedFrameLabel(template: FrameTemplate, separator = " — "): string {
  const setLabel = FRAME_SET_LABELS[FRAME_TEMPLATE_SET[template]];
  const label = FRAME_TEMPLATE_LABELS[template];
  return label.includes(setLabel) ? label : `${setLabel}${separator}${label}`;
}

/** A frame's label inside its era group (the admin frame checklist): a
 *  showcase frame names its set ("Zendikar Rising — Hedron"), since the
 *  showcase era mixes many sets; a border-era frame keeps its set-relative
 *  label ("Snow"). */
export function eraGroupFrameLabel(template: FrameTemplate): string {
  return FRAME_SET_ERA[FRAME_TEMPLATE_SET[template]] === "showcase"
    ? setQualifiedFrameLabel(template)
    : FRAME_TEMPLATE_LABELS[template];
}

/** Toast/error copy for a frame: "M15 (2015) Snow", "The Lord of the Rings
 *  Ring". Template labels are set-relative, so the era/set is prepended. */
export function describeFrame(template: FrameTemplate): string {
  const set = FRAME_TEMPLATE_SET[template];
  if (FRAME_SET_ERA[set] === "showcase") return setQualifiedFrameLabel(template, " ");
  return `${FRAME_ERA_LABELS[FRAME_SET_ERA[set]]} ${FRAME_TEMPLATE_LABELS[template]}`;
}
