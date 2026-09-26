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
import {
  isArtifactFrameType,
  pickFrameColorKey,
} from "@/components/cards/frame-layer";
import { eraForTemplate, standardFrameFor } from "@/lib/creator/frame-picker";
import {
  baseFrameFor,
  framesForKind,
  isBorrowedVariation,
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
    // another type (the artifact frame on a creature, TODO 1.7): it would
    // dress a plain creature as an artifact.
    const any = gallery.find(
      (choice) =>
        !templateIsBasicOnly(choice.template) &&
        !isBorrowedVariation(kind, choice.template) &&
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

/** The frames a Scryfall import asks resolvePublishedFrame for, most wanted
 *  first: the printing's own frame, its era's standard for the card type,
 *  then the M15 standard. An Artifact Creature asks for M15's artifact frame
 *  before the plain one (TODO 1.7), so a Juggernaut whose Alpha frame isn't
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
  const wanted = patch.frame_template ?? current.template ?? DEFAULT_FRAME_TEMPLATE;
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
