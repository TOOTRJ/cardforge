"use client";

// The creator's half of a new card's automatic tags: the Tags field follows
// the card's rules text and subtypes — the front's, and the back face's or
// second part's while the card has one — until the field changes under
// anything else (lib/creator/auto-tags-follow.ts holds the rule). `enabled`
// is a plain new card alone — an edit never rewrites a stored card's tags, a
// remix starts from its parent's, and a deck-card proxy (/create?deckCard=)
// starts from the printing it copies, whose "unchanged" baseline must not
// move under it. `restart` is Start over's. `following` is false once the
// follow has ended (the Tags helper stops promising to fill the field).
//
// The field's CURRENT value is read with getValues, never the render's
// watched copy: under React StrictMode an effect runs twice on mount, and
// the second run still sees the render's tags (blank) after the first run
// wrote the suggestions — read as "the maker changed the field", it ended
// the follow on a create form that mounts already filled.

import { useCallback, useEffect, useRef, useState } from "react";
import { useWatch, type UseFormReturn } from "react-hook-form";
import type { FormValues } from "@/lib/creator/form-types";
import { NEW_AUTO_TAGS_FOLLOW, stepAutoTagsFollow, type AutoTagsFollow } from "@/lib/creator/auto-tags-follow";

export function useAutoTagsFollow(
  form: Pick<UseFormReturn<FormValues>, "control" | "setValue" | "getValues">,
  enabled: boolean,
): { restart: () => void; following: boolean } {
  const { control, setValue, getValues } = form;
  const [rulesText, subtypesText, cardType, tagsText, hasBackFace, backRules, backSubtypes] = useWatch({
    control,
    name: [
      "rules_text",
      "subtypes_text",
      "card_type",
      "tags_text",
      "has_back_face",
      "back_face.rules_text",
      "back_face.subtypes_text",
    ],
  });
  const follow = useRef<AutoTagsFollow>(NEW_AUTO_TAGS_FOLLOW);
  const [following, setFollowing] = useState(true);
  useEffect(() => {
    if (!enabled) return;
    const current = getValues("tags_text") ?? "";
    const { state, write } = stepAutoTagsFollow(follow.current, current, {
      rules_text: rulesText,
      subtypes: subtypesText,
      card_type: cardType,
      otherFaces: hasBackFace ? [{ rules_text: backRules, subtypes: backSubtypes }] : null,
    });
    follow.current = state;
    if (write !== null) setValue("tags_text", write);
    setFollowing(state.following);
  }, [enabled, rulesText, subtypesText, cardType, tagsText, hasBackFace, backRules, backSubtypes, setValue, getValues]);
  const restart = useCallback(() => {
    follow.current = NEW_AUTO_TAGS_FOLLOW;
    setFollowing(true);
  }, []);
  return { restart, following: enabled && following };
}
