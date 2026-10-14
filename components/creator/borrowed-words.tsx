"use client";

// The words a borrowed frame wrote (TODO 1.7 / 4.7; owner decision 3, Round
// 56, 2026-10-13). A frame a creature or an artifact BORROWS dresses the
// card as another type too — the artifact frame an Artifact Creature, the
// Nyx frame an Enchantment Creature / Artifact — so picking one on a card
// whose type words don't say that word WRITES it into the supertype
// (card-setup-panel.tsx). The word is the frame's: once the card leaves the
// frame that wrote it (Standard, another variation, another kind, a colour
// the frame isn't verified in) it comes out again.
//
// This is the memory of WHICH words a frame pick wrote, kept by the creator
// form — not by the Card step's panel, which unmounts on a step change and
// used to forget (the word then stayed for good). Three rules:
//   • only a word a frame pick wrote is ever removed, and only once — a
//     word that was there before the pick is the maker's and is never
//     touched;
//   • a word the maker types or keeps BY HAND is theirs from then on: any
//     edit of the front face's Types field forgets every word remembered
//     here (the field then says what the maker wants it to say);
//   • another card forgets too — an import, an AI fill or an idea that
//     writes the type words, Start over, a reset — so a memory can never
//     reach into a card it was not made on.
// A NEW card only: an edit or a remix has no Card step (the type words are
// locked), so nothing is ever remembered there and nothing is ever removed.
// It is not form state and never travels with a save.

import { createContext, useContext, useEffect, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { borrowedTypeWord, withoutTypeWord, type BorrowedTypeWord, type CardKind } from "@/lib/creator/card-kinds";
import { normalizeFrameTemplate } from "@/lib/cards/card-display";
import { DEFAULT_FRAME_TEMPLATE, type FrameTemplate } from "@/types/card";
import type { FormValues } from "@/lib/creator/form-types";

export type BorrowedWordSeeds = {
  /** A frame pick wrote `word` into the type words. */
  seed: (word: BorrowedTypeWord) => void;
  /** The remembered words the card no longer wears a frame for, now that
   *  it is `kind` on `template` — forgotten as they are returned. */
  leave: (kind: CardKind, template: FrameTemplate) => BorrowedTypeWord[];
  /** Nothing is the frame's any more (a hand edit, another card). */
  forget: () => void;
  /** The words remembered (tests). */
  words: () => BorrowedTypeWord[];
};

/** The memory itself. Pure but for its own set. */
export function createBorrowedWordSeeds(): BorrowedWordSeeds {
  const seeded = new Set<BorrowedTypeWord>();
  return {
    seed: (word) => {
      seeded.add(word);
    },
    leave: (kind, template) => {
      if (seeded.size === 0) return [];
      const wearing = borrowedTypeWord(kind, template);
      const left = [...seeded].filter((word) => word !== wearing);
      for (const word of left) seeded.delete(word);
      return left;
    },
    forget: () => seeded.clear(),
    words: () => [...seeded],
  };
}

const BorrowedWordSeedsContext = createContext<BorrowedWordSeeds | null>(null);

/** The creator form hands its memory to the Card step's panel and to the
 *  Types field. */
export const BorrowedWordSeedsProvider = BorrowedWordSeedsContext.Provider;

/** The form's memory, or null outside a creator form. */
export function useProvidedBorrowedWordSeeds(): BorrowedWordSeeds | null {
  return useContext(BorrowedWordSeedsContext);
}

/**
 * Owns a memory: takes a remembered word out of the supertype when the card
 * leaves the frame that wrote it. `enabled` false (a panel under a form that
 * owns one already; an edit or a remix) keeps the hook inert.
 */
export function useBorrowedWordSeedsOwner(
  { getValues, setValue }: Pick<UseFormReturn<FormValues>, "getValues" | "setValue">,
  input: { kind: CardKind; template: string | null | undefined; enabled: boolean },
): BorrowedWordSeeds {
  const { kind, template, enabled } = input;
  const [seeds] = useState(createBorrowedWordSeeds);
  useEffect(() => {
    if (!enabled) return;
    const left = seeds.leave(kind, normalizeFrameTemplate((template ?? DEFAULT_FRAME_TEMPLATE) as FrameTemplate));
    if (left.length === 0) return;
    const before = getValues("supertype") ?? "";
    const next = left.reduce<string>((acc, word) => withoutTypeWord(acc, word), before);
    if (next !== before) setValue("supertype", next, { shouldDirty: true });
  }, [seeds, enabled, kind, template, getValues, setValue]);
  return seeds;
}
