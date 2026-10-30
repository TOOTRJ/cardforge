"use client";

// The creator's half of a new card's automatic tags: the Tags field follows
// the card's name, rules text and subtypes until the field changes under
// anything else (lib/creator/auto-tags-follow.ts holds the rule). `enabled`
// is the create mode alone — an edit never rewrites a stored card's tags,
// and a remix starts from its parent's. `restart` is Start over's.

import { useCallback, useEffect, useRef } from "react";
import { useWatch, type UseFormReturn } from "react-hook-form";
import type { FormValues } from "@/lib/creator/form-types";
import { NEW_AUTO_TAGS_FOLLOW, stepAutoTagsFollow, type AutoTagsFollow } from "@/lib/creator/auto-tags-follow";

export function useAutoTagsFollow(
  form: Pick<UseFormReturn<FormValues>, "control" | "setValue">,
  enabled: boolean,
): { restart: () => void } {
  const { control, setValue } = form;
  const [title, rulesText, subtypesText, cardType, tagsText] = useWatch({
    control,
    name: ["title", "rules_text", "subtypes_text", "card_type", "tags_text"],
  });
  const follow = useRef<AutoTagsFollow>(NEW_AUTO_TAGS_FOLLOW);
  useEffect(() => {
    if (!enabled) return;
    const { state, write } = stepAutoTagsFollow(follow.current, tagsText ?? "", {
      title,
      rules_text: rulesText,
      subtypes: subtypesText,
      card_type: cardType,
    });
    follow.current = state;
    if (write !== null) setValue("tags_text", write);
  }, [enabled, title, rulesText, subtypesText, cardType, tagsText, setValue]);
  const restart = useCallback(() => {
    follow.current = NEW_AUTO_TAGS_FOLLOW;
  }, []);
  return { restart };
}
