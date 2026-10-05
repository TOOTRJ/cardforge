"use client";

// The one-click move of an imported double-faced card onto the real frames
// (TODO 5.2; owner 2026-10-02, Q3: in place, one click). Shown on the
// Identity step of a stored card whose back is a LEGACY back — content
// only, drawn on the front's m15 frame (the 8 imported DFCs) — and whose two
// faces the wave-1 bodies can draw (lib/cards/dfc-adopt.ts
// dfcAdoptionOffer). Nothing happens until the owner clicks: the front moves
// to its DFC twin, the back gets its frame and colour (the front's — locked
// afterwards like the front's, owner 2026-10-05), both faces re-bake
// (adoptDfcBodiesAction). The layout is the one the back's SHAPE derives —
// a back with a mana cost is a modal card — never a choice (owner
// 2026-10-05), and a layout whose bodies don't exist shows NO hint at all
// (none since 5.1b's modal pair): a costed back is never offered
// Transform, which would drop its cost. The button is dark until the card's
// colour is verified on both bodies (the Transform chip's rule, after the
// owner's ticks).

import { useTransition } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { adoptDfcBodiesAction } from "@/lib/cards/dfc-adopt-actions";
import { adoptedBackColorIdentity, dfcAdoptionOffer, type DfcAdoptionCard } from "@/lib/cards/dfc-adopt";
import { isFrameComboAvailable } from "@/lib/cards/frame-availability";
import { pickFrameColorKey } from "@/lib/cards/frame-color-key";

type DfcAdoptHintProps = {
  cardId: string;
  card: DfcAdoptionCard;
  verifiedFrameKeys: ReadonlySet<string>;
  /** The move landed: the page reloads the card (the editor then opens the
   *  back-face panel on the new body). */
  onMoved?: () => void;
};

export function DfcAdoptHint({ cardId, card, verifiedFrameKeys, onMoved }: DfcAdoptHintProps) {
  const offer = dfcAdoptionOffer(card);
  const [isPending, startTransition] = useTransition();
  if (!offer) return null;

  const colorKey = pickFrameColorKey(card.color_identity);
  // The back is judged in the colour the move gives it (the front's, or
  // colourless on the land back — lib/cards/dfc-adopt.ts).
  const backColour = adoptedBackColorIdentity(offer.backBody, card.color_identity);
  const backColorKey = pickFrameColorKey(backColour);
  const landBack = backColorKey === "c" && colorKey !== "c";
  const verified =
    isFrameComboAvailable(offer.frontBody, colorKey, verifiedFrameKeys) &&
    isFrameComboAvailable(offer.backBody, backColorKey, verifiedFrameKeys);
  const layoutLabel = offer.label.toLowerCase();

  const move = () => {
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof adoptDfcBodiesAction>>;
      try {
        result = await adoptDfcBodiesAction(cardId, offer.layout);
      } catch (error) {
        console.error("[dfc-adopt] request failed", error);
        toast.error("The move didn't go through — try again.");
        return;
      }
      if (!result.ok) {
        toast.error(result.formError);
        return;
      }
      toast.success(`Moved onto the ${layoutLabel} frames — both faces are re-baking.`);
      onMoved?.();
    });
  };

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-gold/40 bg-gold/5 px-4 py-3"
      data-testid="dfc-adopt-hint"
    >
      <p className="text-xs leading-5 text-foreground">
        <strong className="font-semibold">New: the real double-faced frames.</strong>{" "}
        This card&apos;s back face still sits on the front&apos;s frame. Move it onto the
        double-faced frames: the front gets the {layoutLabel} front, the back its own
        frame and colour ({landBack ? "colourless — a land has none" : "the front's"}), and
        both faces re-bake. Nothing changes until you click.
        {offer.losesDress
          ? ` The ${offer.losesDress} look is left behind: no double-faced ${offer.losesDress} frame exists yet.`
          : ""}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={!verified || isPending}
          onClick={move}
          data-testid="dfc-adopt-move"
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="h-4 w-4" aria-hidden />
          )}
          Move onto the {layoutLabel} frames
        </Button>
        {!verified ? (
          <span className="text-[11px] text-subtle" role="status">
            Frames awaiting verification in this card&apos;s colour.
          </span>
        ) : null}
      </div>
    </div>
  );
}
