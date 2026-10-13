"use client";

// The one line under a face's power / toughness inputs when the card's
// frame draws none (lib/cards/pt-drawn.ts — the profiles' own P/T slots, the
// data both renderers gate the plate on). A saga whose type says Creature, a
// planeswalker frame, a battle, a split half: the numbers are saved with the
// card and the picture shows none, and the creator used to say nothing.
//
// It watches the card's frame itself, so it follows a frame or kind change
// live; a panel only renders it beside the inputs it already shows.

import { useId } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import type { FormValues } from "@/lib/creator/form-types";
import {
  frontDrawsPowerToughness,
  PT_NOT_DRAWN_NOTE,
  secondFaceDrawsPowerToughness,
} from "@/lib/cards/pt-drawn";
import { cn } from "@/lib/utils";

type PtNotDrawnNoteProps = {
  /** Whose inputs the note sits under: the card's front, or its second /
   *  back face (`back_face`). */
  face: "front" | "second";
  /** A double-faced card's BACK body (the back face panel's `backBody`);
   *  leave out for a half painted on the front's frame. */
  backBody?: string | null;
  /** Show the note only once the face has a number: for inputs that are
   *  not gated on the face's type (a split half's stat row). */
  onlyWithValue?: boolean;
};

/** Whether the note shows: the face's frame draws no power / toughness (and,
 *  with `onlyWithValue`, the face holds a number). */
function usePtNotDrawn({ face, backBody = null, onlyWithValue = false }: PtNotDrawnNoteProps): boolean {
  const { control } = useFormContext<FormValues>();
  const [template, power, toughness] = useWatch({
    control,
    name: [
      "frame_style.template",
      face === "front" ? "power" : "back_face.power",
      face === "front" ? "toughness" : "back_face.toughness",
    ],
  });
  const drawn =
    face === "front" ? frontDrawsPowerToughness(template) : secondFaceDrawsPowerToughness(template, backBody);
  if (drawn) return false;
  if (onlyWithValue && !String(power ?? "").trim() && !String(toughness ?? "").trim()) return false;
  return true;
}

/**
 * The note's id WHILE it shows, else undefined — for the `aria-describedby`
 * of the Power and Toughness inputs it sits under (TODO 3b.19): a screen
 * reader hears "this frame draws no power / toughness" on the inputs, not
 * only if it happens to read on past them. Pass the same props as the note,
 * and the id to it:
 *
 *   const ptNoteId = usePtNotDrawnNoteId({ face: "front" });
 *   <input aria-describedby={ptNoteId} … />
 *   <PtNotDrawnNote face="front" id={ptNoteId} />
 */
export function usePtNotDrawnNoteId(props: PtNotDrawnNoteProps): string | undefined {
  const id = useId();
  return usePtNotDrawn(props) ? `${id}-pt-not-drawn` : undefined;
}

export function PtNotDrawnNote({
  id,
  className,
  ...props
}: PtNotDrawnNoteProps & { id?: string; className?: string }) {
  if (!usePtNotDrawn(props)) return null;
  return (
    <p id={id} data-testid={`pt-not-drawn-note-${props.face}`} className={cn("text-xs text-muted", className)}>
      {PT_NOT_DRAWN_NOTE}
    </p>
  );
}
