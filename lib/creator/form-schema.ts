// Client-side validation schema for the card creator's FormValues shape.
//
// The server (lib/validation/card.ts → createCardSchema) remains the
// authority; this schema exists so users see field errors BEFORE a server
// round trip. It therefore mirrors runSubmit's payload mapping exactly:
// every check runs against the value the server would actually receive
// (trimmed strings, parsed subtype/tag lists, filtered loyalty/saga rows),
// reusing the exported server field schemas so limits and messages can
// never drift. Anything the server would accept must pass here — with two
// deliberate exceptions where the server SILENTLY TRUNCATES free-text
// lists (subtypes beyond 10, tags beyond 12 / over 30 chars): silently
// dropping what the user typed is worse UX than an inline error, so the
// client surfaces those as errors instead.
//
// No transforms: input and output are both FormValues, so react-hook-form's
// zodResolver hands runSubmit the untouched form state and drafts /
// localStorage restores are unaffected.

import { z } from "zod";
import {
  cardArtistCreditSchema,
  cardArtUrlSchema,
  cardCostSchema,
  cardFlavorTextSchema,
  cardRulesTextSchema,
  cardStatStringSchema,
  cardSupertypeSchema,
  cardTitleSchema,
  loyaltyCostSchema,
} from "@/lib/validation/card";
import { kindFromCard } from "@/lib/creator/card-kinds";
import type { FormValues } from "@/lib/creator/form-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Ctx = z.core.$RefinementCtx;
type PathSegment = string | number;

/** Run a server field schema against the value the server would receive and
 *  copy its first issue message onto the given form-field path. */
function check(
  ctx: Ctx,
  path: PathSegment[],
  schema: z.ZodType,
  value: unknown,
): void {
  const result = schema.safeParse(value);
  if (!result.success) {
    ctx.addIssue({
      code: "custom",
      path,
      message: result.error.issues[0]?.message ?? "Invalid value.",
    });
  }
}

/** Split a comma/newline separated subtype field the way parseSubtypes does,
 *  but WITHOUT the silent `.slice(0, 10)` — the count check needs to see
 *  everything the user typed. */
function splitSubtypes(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0);
}

/** Normalize a tags field the way cardTagsSchema does (lowercase,
 *  alphanumeric + spaces/hyphens, deduped) but keep over-limit entries so
 *  they can error instead of silently vanishing. */
function splitTags(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(/[,\n]/)
        .map((piece) =>
          piece
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, "")
            .replace(/\s+/g, " ")
            .trim(),
        )
        .filter((piece) => piece.length > 0),
    ),
  );
}

/** Shared subtype checks (front + back face use identical limits). */
function checkSubtypesText(ctx: Ctx, path: PathSegment[], text: string): void {
  const parts = splitSubtypes(text);
  if (parts.length > 10) {
    ctx.addIssue({
      code: "custom",
      path,
      message: "A card can have up to 10 subtypes.",
    });
  }
  if (parts.some((part) => part.length > 40)) {
    ctx.addIssue({
      code: "custom",
      path,
      message: "Each subtype must be 40 characters or fewer.",
    });
  }
}

// ---------------------------------------------------------------------------
// The schema — a passthrough over FormValues with per-field refinements.
// Issue order follows the wizard's step order (identity → text → publish)
// so the submit error handler jumps to the earliest errored step.
// ---------------------------------------------------------------------------

export const cardFormSchema: z.ZodType<FormValues, FormValues> = z
  .custom<FormValues>()
  .superRefine((values, ctx) => {
    // ----- Identity step -----
    check(ctx, ["title"], cardTitleSchema, values.title);
    check(ctx, ["supertype"], cardSupertypeSchema, values.supertype.trim());
    checkSubtypesText(ctx, ["subtypes_text"], values.subtypes_text);
    check(ctx, ["cost"], cardCostSchema, values.cost.trim());
    check(
      ctx,
      ["artist_credit"],
      cardArtistCreditSchema,
      values.artist_credit.trim(),
    );
    check(ctx, ["art_url"], cardArtUrlSchema, values.art_url.trim());

    // Back face — only validated when it will actually be sent (runSubmit
    // sends null when the toggle is off, which the server always accepts).
    if (values.has_back_face) {
      const back = values.back_face;
      check(ctx, ["back_face", "title"], cardTitleSchema, back.title);
      check(ctx, ["back_face", "cost"], cardCostSchema, back.cost.trim());
      check(
        ctx,
        ["back_face", "supertype"],
        cardSupertypeSchema,
        back.supertype.trim(),
      );
      checkSubtypesText(ctx, ["back_face", "subtypes_text"], back.subtypes_text);
      check(
        ctx,
        ["back_face", "rules_text"],
        cardRulesTextSchema,
        back.rules_text.trim(),
      );
      check(
        ctx,
        ["back_face", "flavor_text"],
        cardFlavorTextSchema,
        back.flavor_text.trim(),
      );
      for (const stat of ["power", "toughness", "loyalty", "defense"] as const) {
        check(ctx, ["back_face", stat], cardStatStringSchema, back[stat].trim());
      }
      check(
        ctx,
        ["back_face", "artist_credit"],
        cardArtistCreditSchema,
        back.artist_credit.trim(),
      );
      check(ctx, ["back_face", "art_url"], cardArtUrlSchema, back.art_url.trim());
    }

    // ----- Text step -----
    // Mirrors runSubmit's kind routing exactly: planeswalkers/sagas submit
    // their (filtered) structured rows and a serialized rules_text — the raw
    // textarea only ships when no rows survive, so it's only validated then.
    const submitKind = kindFromCard(
      values.card_type,
      values.frame_style?.template,
    );
    let rulesTextIsSubmitted = true;
    if (submitKind === "planeswalker") {
      const surviving = values.loyalty_abilities
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => row.text.trim().length > 0);
      rulesTextIsSubmitted = surviving.length === 0;
      for (const { row, index } of surviving) {
        if (row.text.trim().length > 600) {
          ctx.addIssue({
            code: "custom",
            path: ["loyalty_abilities", index, "text"],
            message: "Ability text must be 600 characters or fewer.",
          });
        }
        // Same normalization + pattern the server applies (U+2212/en-dash
        // minus fold to ASCII; blank = static row = null cost).
        check(
          ctx,
          ["loyalty_abilities", index, "cost"],
          loyaltyCostSchema,
          row.cost.trim() ? row.cost.trim() : null,
        );
      }
    } else if (submitKind === "saga") {
      const surviving = values.saga_chapters
        .map((row, index) => ({ row, index }))
        .filter(
          ({ row }) => row.text.trim().length > 0 && row.numerals.length > 0,
        );
      rulesTextIsSubmitted = surviving.length === 0;
      for (const { row, index } of surviving) {
        if (row.text.trim().length > 600) {
          ctx.addIssue({
            code: "custom",
            path: ["saga_chapters", index, "text"],
            message: "Chapter text must be 600 characters or fewer.",
          });
        }
      }
      if (surviving.length > 0 && values.saga_intro.trim().length > 400) {
        ctx.addIssue({
          code: "custom",
          path: ["saga_intro"],
          message: "Intro must be 400 characters or fewer.",
        });
      }
    }
    if (rulesTextIsSubmitted) {
      check(ctx, ["rules_text"], cardRulesTextSchema, values.rules_text.trim());
    }

    check(
      ctx,
      ["flavor_text"],
      cardFlavorTextSchema,
      values.flavor_text.trim(),
    );
    for (const stat of ["power", "toughness", "loyalty", "defense"] as const) {
      check(ctx, [stat], cardStatStringSchema, values[stat].trim());
    }

    // ----- Publish step -----
    // The server (cardTagsSchema) silently drops over-limit tags; the client
    // errors instead so nothing the user typed vanishes without a word.
    const tags = splitTags(values.tags_text);
    if (tags.length > 12) {
      ctx.addIssue({
        code: "custom",
        path: ["tags_text"],
        message: "A card can have up to 12 tags.",
      });
    }
    if (tags.some((tag) => tag.length > 30)) {
      ctx.addIssue({
        code: "custom",
        path: ["tags_text"],
        message: "Each tag must be 30 characters or fewer.",
      });
    }
  });
