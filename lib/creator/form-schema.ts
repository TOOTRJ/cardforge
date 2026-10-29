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
// nothing else reads the raw form state.

import { isStationFrame } from "@/lib/cards/station-frame";
import { stationTiersProblem } from "@/lib/creator/station-rows";
import { z } from "zod";
import {
  cardArtistCreditSchema,
  cardArtUrlSchema,
  cardCollectorNumberSchema,
  cardCostSchema,
  cardFlavorTextSchema,
  cardLangSchema,
  cardRulesTextSchema,
  cardSetCodeSchema,
  cardStatStringSchema,
  cardSupertypeSchema,
  cardPrintedTypesSchema,
  cardNicknameSchema,
  cardTitleSchema,
  loyaltyCostSchema,
} from "@/lib/validation/card";
import { dfcFrontBodyFor, dfcLayoutForCard, kindFromCard } from "@/lib/creator/card-kinds";
import { colorlessFaceAllowed, colorlessFaceFits, dfcLookOf, isDfcFaceType, isSagaFront, type DfcIconFamily } from "@/lib/cards/dfc";
import { creatorBackBodyFor } from "@/lib/creator/saga-back";
import { SAGA_TWO_FACES_COLOURLESS } from "@/lib/creator/saga-faces";
import { dfcFamilyOf, dfcFrontColorError, dfcFrontTypeError, DFC_BACK_TYPE_REFUSED, DFC_COLORLESS_NEEDS_ARTIFACT, DFC_SEE_THROUGH_UNVERIFIED } from "@/lib/cards/dfc-gate";
import { pickFrameColorKey } from "@/lib/cards/frame-color-key";
import {
  missingSecondFaceName,
  SECOND_FACE_NAME_ERROR,
} from "@/lib/cards/second-face-name";
import type { FormValues } from "@/lib/creator/form-types";
import {
  sagaRowsLosingMarker,
  sagaRowsNeedingNumber,
  structuredRowsUntouched,
  type StructuredRulesValues,
} from "@/lib/creator/structured-rules";
import { keepsStoredMarker, markerText, unreadableMarkerParts } from "@/lib/cards/face-content";
import { listPhrase } from "@/lib/creator/save-needs";

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

/** What a saga row with a text and no chapter number says (TODO 3b.19): it
 *  used to be dropped by the save without a word. */
export const SAGA_ROW_NEEDS_NUMBER = "Pick a chapter number for this row, or remove it.";

/** What a saga row says once its NUMBERS were changed while its stored
 *  marker holds a numeral the editor has no toggle for ("I, XI —"): saving
 *  would drop that numeral (lib/creator/structured-rules.ts
 *  sagaRowsLosingMarker). `stored` = the marker as a rules line spells it
 *  ("I, XI"), `lost` its numerals the editor can't set. */
export function sagaRowLosesMarkerMessage(stored: string, lost: readonly string[]): string {
  const numerals = listPhrase(lost);
  return `This row is stored as “${stored}”, and the editor can’t set ${numerals}. Put its chapters back to keep it as it is, or drop ${numerals}.`;
}

/**
 * The form's schema. `opened` = an EDIT's values as the form opened with
 * them (the stored card's): while a walker's / saga's rows still read as
 * those, the save keeps the stored text byte for byte
 * (lib/creator/structured-rules.ts), so nothing about the rows is checked —
 * a stored card always opens and retitles, whatever its text holds (a marker
 * the editor cannot number, a line past 600 characters). Once the maker
 * edits a row the checks are back for every row: the save then writes what
 * the editor shows.
 */
/** What the form knows of a double-faced back's BODY beyond its values
 *  (TODO 5.5 (b), PR 2): the verified keys and, on an edit, the stored back
 *  body and family — so the colourless check below asks the body the save
 *  will store (`creatorBackBodyFor` → `backBodyFor`, the server gate's ONE
 *  answer), never a body of its own. Absent: nothing is verified, a create —
 *  `bodyFor`'s body, as before. */
export type FormBackBodyContext = {
  mode: "create" | "edit" | "remix";
  verifiedKeys: ReadonlySet<string>;
  storedBackTemplate?: string | null;
  storedFamily?: DfcIconFamily | null;
};

const NO_BACK_BODY_CONTEXT: FormBackBodyContext = { mode: "create", verifiedKeys: new Set() };

export function cardFormSchemaFor(
  opened: StructuredRulesValues | null = null,
  backBody: FormBackBodyContext = NO_BACK_BODY_CONTEXT,
): z.ZodType<FormValues, FormValues> {
  return z
  .custom<FormValues>()
  .superRefine((values, ctx) => {
    // The keys the colourless rule reads (TODO 5.11a): none on an edit.
    const colourlessKeys = backBody.mode === "edit" ? null : backBody.verifiedKeys;
    // ----- Card step -----
    // A double-faced FRONT is one of the wave-1 face types, on the body its
    // type derives (owner Q2; lib/cards/dfc-gate.ts — the face-type chips
    // offer nothing else), and may be colourless only with "Artifact" on
    // its type line (design D2) — the back's rule below.
    {
      const frontTypeError = dfcFrontTypeError(values.frame_style?.template, values.card_type || null);
      if (frontTypeError) {
        ctx.addIssue({ code: "custom", path: ["frame_style"], message: frontTypeError });
      }
      // (On an EDIT the colour is locked and the see-through tick is the
      // server's question — a card stored on the see-through `c` stays
      // editable after an untick, the legacy pin: `null` keys ask only the
      // structural rule, the Artifact word on a stand-in `c`.)
      const frontColourError = dfcFrontColorError(
        values.frame_style?.template,
        { cardType: values.card_type || null, supertype: values.supertype },
        values.color_identity,
        colourlessKeys,
      );
      if (frontColourError) {
        ctx.addIssue({ code: "custom", path: ["color_identity"], message: frontColourError });
      }
    }

    // ----- Identity step -----
    check(ctx, ["title"], cardTitleSchema, values.title);
    // The nickname (TODO 6.3); "" = none.
    if (typeof values.nickname === "string" && values.nickname.trim()) {
      check(ctx, ["nickname"], cardNicknameSchema, values.nickname);
    }
    check(ctx, ["supertype"], cardSupertypeSchema, values.supertype.trim());
    // The Types field as typed (TODO 3b.16); null = never edited.
    if (typeof values.printed_types === "string") {
      check(ctx, ["printed_types"], cardPrintedTypesSchema, values.printed_types);
    }
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
      // The name is a publishing requirement, not a draft one (TODO 3b.5,
      // lib/cards/second-face-name.ts), judged at the visibility runSubmit
      // sends: "Save as a draft" is private, and so is an artless public
      // save (the server stores it private).
      const sentVisibility = values.save_as_draft
        ? "private"
        : values.visibility === "public" && !values.art_url.trim()
          ? "private"
          : values.visibility;
      if (back.title.trim()) {
        check(ctx, ["back_face", "title"], cardTitleSchema, back.title);
      } else if (missingSecondFaceName(back, sentVisibility)) {
        ctx.addIssue({
          code: "custom",
          path: ["back_face", "title"],
          message: SECOND_FACE_NAME_ERROR,
        });
      }
      check(ctx, ["back_face", "cost"], cardCostSchema, back.cost.trim());
      check(
        ctx,
        ["back_face", "supertype"],
        cardSupertypeSchema,
        back.supertype.trim(),
      );
      if (typeof back.printed_types === "string") {
        check(ctx, ["back_face", "printed_types"], cardPrintedTypesSchema, back.printed_types);
      }
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

      // A double-faced card's back (TODO 5.2) — the server's rules the
      // form can judge without the verified keys (lib/cards/dfc-gate.ts):
      // the back is one of the wave-1 face types, and colourless only with
      // "Artifact" on its type line where its body's `c` is the artifact
      // stand-in (design D2). The body itself is derived at submit; its
      // verification is the server's gate (the chips hide what isn't).
      const dfcKind = kindFromCard(values.card_type, values.frame_style?.template);
      // (A saga on the double-faced saga front — TODO 5.5 (b) — is a
      // transform front: dfcLayoutForCard.)
      const dfcLayout = dfcLayoutForCard(dfcKind, values.frame_style?.template);
      const dfcLook = dfcLookOf(values.frame_style?.template);
      if (dfcLayout && (isSagaFront(values.frame_style?.template) || dfcFrontBodyFor(dfcKind, values.card_type, dfcLook))) {
        if (!isDfcFaceType(back.card_type)) {
          ctx.addIssue({ code: "custom", path: ["back_face", "card_type"], message: DFC_BACK_TYPE_REFUSED });
        } else {
          // The body the save stores — the server gate's answer
          // (backBodyFor: a Saga back on `sagadfcback` where it is verified,
          // whose `c` is no artifact stand-in), never `bodyFor` alone
          // (TODO 5.5 (b), PR 2).
          const body = creatorBackBodyFor({
            mode: backBody.mode,
            layout: dfcLayout,
            backType: back.card_type,
            backSubtypes: back.subtypes_text,
            family: dfcFamilyOf(values.frame_style?.dfcIcon),
            look: dfcLook,
            backColorIdentity: back.color_identity,
            frontColorIdentity: values.color_identity,
            verifiedKeys: backBody.verifiedKeys,
            storedBackTemplate: backBody.storedBackTemplate,
            storedFamily: backBody.storedFamily,
          });
          const colour = back.color_identity.length > 0 ? back.color_identity : values.color_identity;
          if (
            body &&
            pickFrameColorKey(colour) === "c" &&
            !colorlessFaceAllowed(body, { cardType: back.card_type, supertype: back.supertype }, colourlessKeys)
          ) {
            // (A colourless double-faced saga whose back takes the front's
            // colour — TODO 5.5 (b), owner Round 73 — is told so where the
            // back face's colour is refused, in a saga's words.)
            if (isSagaFront(values.frame_style?.template) && back.color_identity.length === 0) {
              ctx.addIssue({ code: "custom", path: ["back_face", "color_identity"], message: SAGA_TWO_FACES_COLOURLESS });
            } else {
              // (The see-through `c` of the modal back, TODO 5.11a, not
              // ticked yet: the face's words are fine, the frame isn't.)
              const message = colorlessFaceFits(body, { cardType: back.card_type, supertype: back.supertype })
                ? DFC_SEE_THROUGH_UNVERIFIED
                : DFC_COLORLESS_NEEDS_ARTIFACT;
              ctx.addIssue({ code: "custom", path: ["back_face", "color_identity"], message });
            }
          }
        }
      }
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
    const rowsUntouched = structuredRowsUntouched(submitKind, values, opened);
    if (submitKind === "planeswalker") {
      const surviving = values.loyalty_abilities
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => row.text.trim().length > 0);
      rulesTextIsSubmitted = surviving.length === 0;
      for (const { row, index } of rowsUntouched ? [] : surviving) {
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
          // (Numbered — or saved under the stored marker it keeps, "XI —".)
          ({ row }) => row.text.trim().length > 0 && (row.numerals.length > 0 || keepsStoredMarker(row)),
        );
      rulesTextIsSubmitted = surviving.length === 0;
      // A row with a text and no chapter number never saves as a chapter:
      // say so on the row instead of dropping it (or, when it is the only
      // row, leaving its text unsaved).
      for (const index of sagaRowsNeedingNumber(submitKind, values, opened)) {
        ctx.addIssue({ code: "custom", path: ["saga_chapters", index, "numerals"], message: SAGA_ROW_NEEDS_NUMBER });
      }
      // …and one whose numbers were changed under a stored marker the
      // editor can't write in full is never saved short of it in silence.
      for (const index of sagaRowsLosingMarker(submitKind, values)) {
        const marker = values.saga_chapters[index]?.marker ?? "";
        ctx.addIssue({
          code: "custom",
          path: ["saga_chapters", index, "numerals"],
          message: sagaRowLosesMarkerMessage(markerText(marker), unreadableMarkerParts(marker)),
        });
      }
      for (const { row, index } of rowsUntouched ? [] : surviving) {
        if (row.text.trim().length > 600) {
          ctx.addIssue({
            code: "custom",
            path: ["saga_chapters", index, "text"],
            message: "Chapter text must be 600 characters or fewer.",
          });
        }
      }
      if (!rowsUntouched && surviving.length > 0 && values.saga_intro.trim().length > 400) {
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
    // A station card's tiers (TODO 4.27a): the tier editor's rows ARE the
    // rules text, and a save writes them as rows — every tier with a text,
    // the numbers rising. Never asked of an untouched edit: that save keeps
    // the stored card as it is (lib/creator/structured-rules.ts).
    if (isStationFrame(values.frame_style?.template)) {
      const untouched =
        opened !== null && opened.rules_text === values.rules_text && (opened.station_pt_tier ?? null) === (values.station_pt_tier ?? null);
      const problem = untouched ? null : stationTiersProblem(values.rules_text);
      if (problem) ctx.addIssue({ code: "custom", path: ["rules_text"], message: problem });
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

    // ----- Set & collector info step (TODO 4.9a) -----
    // Exactly what runSubmit sends: an empty field is null (the server
    // accepts null), a filled one is trimmed — and upper-cased for the set
    // code, as the server schema does before its pattern.
    check(ctx, ["set_code"], cardSetCodeSchema, values.set_code.trim() || null);
    check(
      ctx,
      ["collector_number"],
      cardCollectorNumberSchema,
      values.collector_number.trim() || null,
    );
    check(ctx, ["lang"], cardLangSchema, values.lang || undefined);

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
}

/** A new card's schema (and a remix's): every check runs. */
export const cardFormSchema = cardFormSchemaFor();
