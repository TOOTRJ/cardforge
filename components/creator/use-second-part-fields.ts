"use client";

// Which never-drawn fields of a one-picture card's second part are on
// screen (TODO 5.14, owner round 52): the rule is
// lib/creator/second-part-fields.ts — hidden while empty, shown with a
// value — and this hook is its memory. A unit that was shown because it
// held a value (a stored card's, an import's, an AI fill's, a kind change's
// restored part, an error the server put on it) STAYS shown after the maker
// empties it: a field never leaves under the person editing it, and what
// they emptied stays where they can see it is empty. It is forgotten when
// the form opens another card (`scope`) or starts over (`forget`).
//
// The memory is per frame: a flip side's power / toughness (drawn, always
// shown) is not remembered as "shown" for a split half.

import { useState } from "react";
import type { FrameProfile } from "@/lib/cards/template-layout";
import {
  heldNeverDrawnUnits,
  neverDrawnSecondPartUnits,
  secondPartShown,
  secondPartUnitOfField,
  SECOND_PART_HIDEABLE,
  type SecondPartHideable,
  type SecondPartShown,
} from "@/lib/creator/second-part-fields";

const NOTHING: ReadonlySet<string> = new Set();

export type SecondPartFields = {
  shown: SecondPartShown;
  /** Show the unit a `back_face.*` field is in (a link or an error that
   *  points at it); a no-op for any other field. */
  reveal: (field: string) => void;
  /** Start over: nothing is remembered as shown. */
  forget: () => void;
};

export function useSecondPartFields(input: {
  /** The profile that paints the second part on the card's own picture —
   *  null for every other card (nothing is hidden there). */
  profile: Pick<FrameProfile, "secondFace" | "adventure"> | null;
  /** The frame the memory is kept for. */
  template: string;
  backFace: Readonly<Record<string, unknown>> | null | undefined;
  /** `formState.errors.back_face`. */
  errors?: Readonly<Record<string, unknown>> | null;
  /** The card the form holds: another card forgets. */
  scope: string;
}): SecondPartFields {
  const { profile, template, backFace, errors, scope } = input;
  const [memory, setMemory] = useState<{ scope: string; keys: ReadonlySet<string> }>({ scope, keys: NOTHING });
  let keys = memory.scope === scope ? memory.keys : NOTHING;

  const never = neverDrawnSecondPartUnits(profile);
  const keyOf = (unit: SecondPartHideable) => `${template}:${unit}`;
  const fresh = heldNeverDrawnUnits(never, backFace, errors)
    .map(keyOf)
    .filter((key) => !keys.has(key));
  // Derived during render (no effect: the field must not flash away for a
  // frame between the maker's keystroke and the memory catching up).
  if (memory.scope !== scope || fresh.length > 0) {
    keys = new Set([...keys, ...fresh]);
    setMemory({ scope, keys });
  }

  const kept = new Set(SECOND_PART_HIDEABLE.filter((unit) => keys.has(keyOf(unit))));
  return {
    shown: secondPartShown({ never, backFace, errors, kept }),
    reveal: (field) => {
      const unit = secondPartUnitOfField(field);
      if (!unit || !never.has(unit)) return;
      setMemory((current) => {
        const base = current.scope === scope ? current.keys : NOTHING;
        return base.has(keyOf(unit)) ? current : { scope, keys: new Set([...base, keyOf(unit)]) };
      });
    },
    forget: () => setMemory({ scope, keys: NOTHING }),
  };
}
