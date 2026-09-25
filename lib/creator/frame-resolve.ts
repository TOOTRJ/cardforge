import {
  FRAME_ERA_LABELS,
  FRAME_SET_ERA,
  FRAME_SET_LABELS,
  FRAME_TEMPLATE_LABELS,
  FRAME_TEMPLATE_SET,
  type FrameTemplate,
} from "@/types/card";
import { isFrameComboAvailable } from "@/lib/cards/frame-availability";
import {
  framesForKind,
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
    const any = gallery.find((choice) =>
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

/** Toast/error copy for a frame: "M15 (2015) Snow", "The Lord of the Rings
 *  Ring". Template labels are set-relative, so the era/set is prepended. */
export function describeFrame(template: FrameTemplate): string {
  const set = FRAME_TEMPLATE_SET[template];
  const label = FRAME_TEMPLATE_LABELS[template];
  if (FRAME_SET_ERA[set] === "showcase") {
    const setLabel = FRAME_SET_LABELS[set];
    return setLabel === label ? label : `${setLabel} ${label}`;
  }
  return `${FRAME_ERA_LABELS[FRAME_SET_ERA[set]]} ${label}`;
}
