import type { CardType, FrameTemplate } from "@/types/card";
import type { FrameMatch } from "@/lib/scryfall/frame-signatures";
import type { ScryfallImportPatch } from "@/lib/scryfall/import-mapper";
import { isFrameComboAvailable } from "@/lib/cards/frame-availability";
import { normalizeFrameTemplate } from "@/lib/cards/card-display";
import { artReachesCardEdge, getFrameProfile } from "@/lib/cards/template-layout";
import { parseSubtypes } from "@/lib/creator/card-fields";
import {
  KIND_DEFS,
  framesForKind,
  isBorrowedVariation,
  isSingleBasicLand,
  kindFromCard,
  templateIsBasicOnly,
  type CardKind,
  type FrameColorKey,
} from "@/lib/creator/card-kinds";
import { describeFrame, resolveImportFrame } from "@/lib/creator/frame-resolve";
import {
  colorWord,
  isArtifactFrameType,
  pickFrameColorKey,
} from "@/components/cards/frame-layer";

// ---------------------------------------------------------------------------
// The import dialog's frame chooser (TODO 1.5, with 1.18's owner decision):
// when the printing's final match isn't exact — or it is an edge-to-edge
// printing the import lands on a bordered frame for, because Scryfall only
// has its art cropped to the bordered window — the user picks the frame
// before committing. The options are the kind's published frames in the
// imported colour; the nearest (resolveImportFrame's landing) is preselected;
// "keep my current frame" is always offered. A substitute card (`reject`)
// can't be imported at all.
//
// Pure and React-free: the dialog renders the plan, the creator re-checks
// the choice when it applies it (a stale choice falls back to the normal
// resolution).
// ---------------------------------------------------------------------------

/** What the dialog hands the creator with the import. */
export type ImportFrameChoice = { template: FrameTemplate } | { keepCurrent: true };

/** The patch fields the chooser reads. */
export type ImportChooserPatch = Pick<
  ScryfallImportPatch,
  | "kind"
  | "card_type"
  | "supertype"
  | "subtypes_text"
  | "title"
  | "rules_text"
  | "color_identity"
  | "frame_template"
  | "frame_match"
>;

export type ImportFrameOption = {
  template: FrameTemplate;
  /** resolveImportFrame's landing — the preselected nearest frame. */
  nearest: boolean;
  /** The frame's art reaches the card edge (Borderless): Scryfall's
   *  window-cropped art is stretched to fill it. */
  edgeToEdge: boolean;
};

export type ImportFramePlan =
  /** Exact (or no match to judge): the import lands without asking. */
  | { mode: "none" }
  /** A substitute card — nothing to import. */
  | { mode: "reject"; exactLabel: string; reason: string }
  | {
      mode: "choose";
      match: Pick<FrameMatch, "status" | "exactLabel" | "template" | "reason" | "landOn">;
      heading: string;
      /** 1.18: the printing's art is cropped to the bordered window. */
      windowCroppedNote: string | null;
      kind: CardKind;
      colorKey: FrameColorKey;
      options: ImportFrameOption[];
      /** "Keep my current frame": the frame the card is on now, when it can
       *  dress the imported card in the imported colour. */
      keepCurrent: { template: FrameTemplate | null; available: boolean; reason: string | null };
      /** What the dialog selects until the user picks. Null when nothing is
       *  published for the kind in this colour (the creator then resolves as
       *  before and says so). */
      preselected: ImportFrameChoice | null;
    };

export const WINDOW_CROPPED_NOTE =
  "Scryfall's art for this printing is cropped to the bordered window.";

/** "the Borderless frame", "the Nyx frame (2003)", "The Lord of the Rings
 *  ring showcase frame" — an exactLabel as a noun phrase for copy. */
export function theFrame(exactLabel: string): string {
  const phrase = /\bframe\b/i.test(exactLabel) ? exactLabel : `${exactLabel} frame`;
  return /^the\s/i.test(phrase) ? phrase : `the ${phrase}`;
}

/** The imported kind: the mapper's layout-aware kind, else the card type's. */
export function importedKindOf(patch: Pick<ScryfallImportPatch, "kind" | "card_type">): CardKind | null {
  return patch.kind ?? (patch.card_type ? kindFromCard(patch.card_type as CardType, undefined) : null);
}

/** True when `template` can dress the imported card in its colour: one of
 *  the kind's published frames in that colour, never a basic-only frame for
 *  a card that isn't one basic land, never a frame the kind borrows from
 *  another type (the artifact dress) for a card that isn't that type. The
 *  chooser's filter and the creator's re-check when it applies a choice. */
export function frameFitsImport(
  template: FrameTemplate,
  input: { kind: CardKind; colorKey: string; verifiedKeys: ReadonlySet<string>; patch: ImportChooserPatch },
): boolean {
  const { kind, colorKey, verifiedKeys, patch } = input;
  if (!isFrameComboAvailable(template, colorKey, verifiedKeys)) return false;
  if (!framesForKind(kind, verifiedKeys).some((choice) => choice.template === template)) {
    return false;
  }
  if (templateIsBasicOnly(template) && !importIsSingleBasic(patch)) return false;
  if (
    isBorrowedVariation(kind, template) &&
    !isArtifactFrameType({ cardType: patch.card_type, supertype: patch.supertype })
  ) {
    return false;
  }
  return true;
}

function importIsSingleBasic(patch: ImportChooserPatch): boolean {
  return isSingleBasicLand({
    cardType: patch.card_type,
    supertype: patch.supertype,
    subtypes: parseSubtypes(patch.subtypes_text ?? ""),
    title: patch.title,
    rulesText: patch.rules_text,
  });
}

/**
 * The chooser for one printing, or `none` / `reject`. `currentTemplate` is
 * the frame the card is on before the import (for "keep my current frame").
 */
export function importFramePlan(
  patch: ImportChooserPatch,
  verifiedKeys: ReadonlySet<string>,
  currentTemplate?: string | null,
): ImportFramePlan {
  const match = patch.frame_match;
  if (!match) return { mode: "none" };
  if (match.reject) {
    return {
      mode: "reject",
      exactLabel: match.exactLabel,
      reason: match.reason ?? "not a playable card",
    };
  }
  const edgeMatch = artReachesCardEdge(getFrameProfile(match.template));
  const windowCropped = Boolean(match.landOn) && edgeMatch;
  if (match.status === "exact" && !match.landOn) return { mode: "none" };

  const kind = importedKindOf(patch);
  if (!kind) return { mode: "none" };
  const colorKey = pickFrameColorKey(patch.color_identity) as FrameColorKey;
  const fits = (template: FrameTemplate) =>
    frameFitsImport(template, { kind, colorKey, verifiedKeys, patch });

  const { resolution } = resolveImportFrame({
    patch,
    kind,
    current: {
      template: currentTemplate ? normalizeFrameTemplate(currentTemplate) : null,
      cardType: patch.card_type ?? null,
      colors: patch.color_identity ?? [],
    },
    verifiedKeys,
  });
  const nearest =
    (resolution.status === "exact" || resolution.status === "frame-switched") &&
    resolution.colorKey === colorKey &&
    fits(resolution.template)
      ? resolution.template
      : null;

  // The nearest first, then the printing's own frame (Borderless, when it is
  // published in this colour), then the kind's other frames in gallery order.
  const gallery = framesForKind(kind, verifiedKeys)
    .map((choice) => choice.template)
    .filter(fits);
  const ordered = Array.from(
    new Set(
      [nearest, fits(match.template) ? match.template : null, ...gallery].filter(
        (t): t is FrameTemplate => Boolean(t),
      ),
    ),
  );
  const options: ImportFrameOption[] = ordered.map((template) => ({
    template,
    nearest: template === nearest,
    edgeToEdge: artReachesCardEdge(getFrameProfile(template)),
  }));

  const current = currentTemplate ? normalizeFrameTemplate(currentTemplate) : null;
  const keepAvailable = current !== null && fits(current);
  const keepCurrent = {
    template: current,
    available: keepAvailable,
    reason: keepAvailable
      ? null
      : current
        ? `${describeFrame(current)} isn't published for ${KIND_DEFS[kind].label.toLowerCase()} cards in ${colorWord(colorKey)}`
        : "No frame yet",
  };

  // Three situations, three headings: PipGlyph has the frame but Scryfall's
  // art can't fill it (an exact edge-to-edge match landing on its bordered
  // twin); PipGlyph has the frame in this colour but not a detail of the
  // printing (the legendary crown, a colour indicator) or can't dress this
  // kind with it yet (a snow ARTIFACT, a Theros god) — the "Why:" line says
  // which; PipGlyph doesn't have the frame (or hasn't verified it in this
  // colour).
  const heading =
    match.status === "exact"
      ? `PipGlyph has ${theFrame(match.exactLabel)}, but Scryfall's art won't fill it — pick one of these`
      : isFrameComboAvailable(match.template, colorKey, verifiedKeys)
        ? `PipGlyph can't match this printing's ${match.exactLabel} exactly yet — pick one of these`
        : `PipGlyph doesn't have ${theFrame(match.exactLabel)} yet — pick one of these`;

  return {
    mode: "choose",
    match: {
      status: match.status,
      exactLabel: match.exactLabel,
      template: match.template,
      reason: match.reason,
      landOn: match.landOn,
    },
    heading,
    windowCroppedNote: windowCropped ? WINDOW_CROPPED_NOTE : null,
    kind,
    colorKey,
    options,
    keepCurrent,
    preselected: nearest
      ? { template: nearest }
      : keepAvailable
        ? { keepCurrent: true }
        : options[0]
          ? { template: options[0].template }
          : null,
  };
}

/**
 * The frame an import's choice lands on, re-checked when the creator applies
 * it (after the kind change): the chosen frame, or the frame the card was on
 * before the import for "keep my current frame" — each only while it still
 * fits (frameFitsImport). Null = stale or no choice: the creator resolves as
 * it always did (resolveImportFrame).
 */
export function appliedImportFrameChoice(input: {
  choice: ImportFrameChoice | null | undefined;
  patch: ImportChooserPatch;
  kind: CardKind | null;
  /** The frame before the import's kind change. */
  templateBefore: string | null | undefined;
  verifiedKeys: ReadonlySet<string>;
}): FrameTemplate | null {
  const { choice, patch, kind, templateBefore, verifiedKeys } = input;
  if (!choice || !kind) return null;
  const template =
    "keepCurrent" in choice
      ? templateBefore
        ? normalizeFrameTemplate(templateBefore)
        : null
      : choice.template;
  if (!template) return null;
  const colorKey = pickFrameColorKey(patch.color_identity);
  return frameFitsImport(template, { kind, colorKey, verifiedKeys, patch }) ? template : null;
}

/** The Card step's "Frame substituted (imported …)" chip: set when the
 *  import lands anywhere but the exact reproduction of the printing. */
export type FrameSubstitution = {
  /** What the printing is ("Borderless frame"). */
  exactLabel: string;
  /** The frame the card landed on — the chip shows while it stays there. */
  template: FrameTemplate;
  reason: string | null;
  /** The card sits on the frame the registry names for this printing, which
   *  PipGlyph can't reproduce exactly yet (the legendary crown, a colour
   *  indicator, the 2023 bars — `reason` says which): the chip says
   *  "Nearest frame", since nothing was swapped for another frame. */
  nearestOnOwnFrame: boolean;
};

type MatchForCopy = Pick<
  FrameMatch,
  "status" | "exactLabel" | "template" | "reason" | "landOn" | "reject"
>;

export function frameSubstitutionFor(
  match: MatchForCopy | undefined,
  landed: FrameTemplate,
): FrameSubstitution | null {
  if (!match || match.reject) return null;
  // On the printing's own exact frame there is nothing to flag — also when
  // the import would have landed on the bordered twin (landOn) and the user
  // picked the edge-to-edge frame itself in the chooser.
  if (match.status === "exact" && landed === match.template) return null;
  return {
    exactLabel: match.exactLabel,
    template: landed,
    reason:
      match.reason ??
      (match.landOn && artReachesCardEdge(getFrameProfile(match.template))
        ? WINDOW_CROPPED_NOTE.replace(/\.$/, "")
        : null),
    nearestOnOwnFrame: landed === match.template,
  };
}

/** The chip's text on the Card step. */
export function frameSubstitutionLabel(substitution: FrameSubstitution): string {
  return substitution.nearestOnOwnFrame
    ? `Nearest frame (imported ${substitution.exactLabel})`
    : `Frame substituted (imported ${substitution.exactLabel})`;
}

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** ONE toast for a substituted import that had no chooser (the deck-remix
 *  pre-fill, /create?deckCard=): names what the printing is and the frame
 *  the card got, in the chooser's three situations — the art can't fill an
 *  edge-to-edge frame PipGlyph has, PipGlyph's frame misses a detail of the
 *  printing (the reason), PipGlyph doesn't have the frame. `available` says
 *  whether a frame is published in the card's colour (the verified combos),
 *  so a nearest edge-to-edge match whose frame IS published is named by its
 *  cropped art, not as missing. Null when the import is the exact
 *  reproduction. */
export function importSubstitutionMessage(
  match: MatchForCopy | undefined,
  landed: FrameTemplate,
  available?: (template: FrameTemplate) => boolean,
): string | null {
  if (!match || !frameSubstitutionFor(match, landed)) return null;
  const windowCropped =
    Boolean(match.landOn) &&
    landed !== match.template &&
    artReachesCardEdge(getFrameProfile(match.template)) &&
    (match.status === "exact" || Boolean(available?.(match.template)));
  if (windowCropped) {
    return `Scryfall's art for this printing is cropped to the bordered window — using ${describeFrame(landed)} instead of ${theFrame(match.exactLabel)}.`;
  }
  if (landed === match.template) {
    return `${sentence(match.reason ?? `PipGlyph can't match ${theFrame(match.exactLabel)} exactly yet`)} — using ${describeFrame(landed)}.`;
  }
  return `PipGlyph doesn't have ${theFrame(match.exactLabel)} yet — using ${describeFrame(landed)}.`;
}
