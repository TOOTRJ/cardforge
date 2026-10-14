"use client";

// The station frame's tier editor (TODO 4.27a, PR 2) — the Text step's rules
// field for a card on a frame whose profile has `tiers` (Spacecraft,
// Planets): the TOP BAND (the ordinary rules box, with the Station reminder)
// and 0–3 TIERS, each a number of charge counters and its text, ONE of them
// carrying the power / toughness.
//
// It is a VIEW of the form's ONE `rules_text` (lib/creator/station-rows.ts):
// the rows are read from the text and every change is written back into it,
// so nothing here can disagree with the text, nothing is written by opening
// a card, and every other way the text arrives (an AI fill, an import, a
// frame change away and back) shows up as rows by itself. The boxes keep the
// maker's keystrokes as typed (a `draft`) for exactly as long as the text is
// still the one they wrote.

import { useId, useMemo, useRef, useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RulesSymbolToolbar } from "@/components/creator/rules-symbol-toolbar";
import { PipTextEditor, type PipTextEditorHandle } from "@/components/creator/pip-text-editor";
import { FieldGroup, inputClass, textareaClass, useFaceLabel } from "@/components/creator/field-group";
import { showsPowerToughness } from "@/lib/cards/card-display";
import { parseSubtypes } from "@/lib/creator/card-fields";
import type { FormValues } from "@/lib/creator/form-types";
import {
  STATION_TIER_LIMIT_NOTE,
  canAddStationTier,
  composeStationText,
  extraTierLines,
  nextThreshold,
  ptChoiceAfterRemove,
  stationPlatedTier,
  stationReminder,
  stationRowsOfText,
  thresholdOf,
  type StationEditorRows,
} from "@/lib/creator/station-rows";
import { printTypography } from "@/lib/validation/print-typography";
import { stationCutNote, stationCutOf, stationOverLimit, stationOverLimitNote } from "@/lib/creator/station-fit";
import { previewFrameStyleOf } from "@/lib/creator/legendary-variation";
import type { CardType } from "@/types/card";

export const STATION_TOP_BAND_HELP =
  "The top band: the card's own abilities and the Station reminder. Click a symbol to drop it in at the cursor — or type its code ({T}, {2}, {W/U}). The tiers go in the rows below.";
export const STATION_TIERS_HELP =
  "Up to three. A tier's text switches on once the card holds that many charge counters; each tier is a band of its own on the card. Leave a tier's text empty and the AI's rules text fills that tier alone — the other bands stay as written.";
export const STATION_PT_HELP =
  "The power / toughness is printed on ONE tier — the one that makes the card a creature. Never on the top band.";

type StationEditorProps = {
  rulesTextRef: React.MutableRefObject<PipTextEditorHandle | null>;
  /** Symbol insertion into the top band at the caret (orchestrator-owned). */
  onInsertSymbol: (token: string) => void;
};

export function StationEditor({ rulesTextRef, onInsertSymbol }: StationEditorProps) {
  const {
    control,
    setValue,
    formState: { errors, defaultValues },
  } = useFormContext<FormValues>();
  const rulesText = useWatch({ control, name: "rules_text" }) ?? "";
  const choice = useWatch({ control, name: "station_pt_tier" }) ?? null;
  const [cardType, subtypesText, supertype] = useWatch({ control, name: ["card_type", "subtypes_text", "supertype"] });
  const faceLabel = useFaceLabel();
  const groupId = useId();

  // The maker's keystrokes, shown instead of the text's own reading for as
  // long as the text is still the one they wrote.
  const [draft, setDraft] = useState<StationEditorRows | null>(null);
  const [refused, setRefused] = useState(false);
  const rows = draft && composeStationText(draft) === rulesText ? draft : stationRowsOfText(rulesText);
  const lastAdded = useRef<number | null>(null);

  const write = (next: StationEditorRows, pt: number | null | undefined = undefined) => {
    setDraft(next);
    setValue("rules_text", composeStationText(next), { shouldDirty: true, shouldValidate: Boolean(errors.rules_text) });
    if (pt !== undefined) setValue("station_pt_tier", pt, { shouldDirty: true, shouldValidate: Boolean(errors.rules_text) });
  };
  const setTier = (index: number, patch: Partial<StationEditorRows["tiers"][number]>) =>
    write({ ...rows, tiers: rows.tiers.map((t, i) => (i === index ? { ...t, ...patch } : t)) });

  // Print typography when a box loses focus (TODO 6.11) — the box alone, and
  // on an EDIT only a box whose text is not one the card opened with: a
  // stored tier never changes where it wasn't edited.
  const opened = stationRowsOfText(typeof defaultValues?.rules_text === "string" ? defaultValues.rules_text : "");
  const openedTexts = new Set([opened.intro, ...opened.tiers.map((t) => t.text)].map((t) => t.trim()));
  const tidy = (text: string) => (openedTexts.has(text.trim()) ? text : printTypography(text, "rules"));

  const hasPt = showsPowerToughness((cardType || null) as CardType | null, parseSubtypes(subtypesText ?? ""), supertype);
  const plated = stationPlatedTier(rulesText, choice);
  const extra = extraTierLines(rulesText);
  const word = cardType === "land" ? "Planet" : "Spacecraft";
  const hasReminder = /\bStation\b/i.test(rows.intro);
  const error = errors.rules_text?.message;

  // Two notes under the tiers — nothing is blocked, no renderer reads them
  // (lib/creator/station-fit.ts). Both are part of the tier group's
  // DESCRIPTION (aria-describedby), never a live region: they come and go
  // as the maker types.
  // 1. The text does not fit its bands (owner round 58, decision 2): read
  //    from the layout of the card the preview draws — real cut text only.
  const [frameStyle, colorIdentity, cost, rarity, flavorText, power, toughness] = useWatch({
    control,
    name: ["frame_style", "color_identity", "cost", "rarity", "flavor_text", "power", "toughness"],
  });
  const fitKey = JSON.stringify([frameStyle, colorIdentity, cost, rarity, flavorText, power, toughness, cardType, subtypesText, supertype, rulesText, choice]);
  const cut = useMemo(
    () =>
      stationCutOf({
        template: frameStyle?.template,
        frameStyle: frameStyle ? previewFrameStyleOf(frameStyle) : null,
        cardType,
        supertype,
        subtypes: parseSubtypes(subtypesText ?? ""),
        colorIdentity,
        cost,
        rarity,
        rulesText,
        flavorText,
        power,
        toughness,
        ptTier: choice,
      }),
    // (The values by their JSON: the watched objects are new every render,
    // and a full box's layout takes a few ms.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fitKey],
  );
  // 2. A band over the row limit: the save keeps the card as lines of text
  //    and the P/T goes back to the tier the text names (the independent
  //    check of #549 — it used to happen without a word).
  const overLimit = stationOverLimit(rulesText, choice, hasPt);
  const thresholds = rows.tiers.map((t) => t.n);
  // In the order the notes are drawn (the row limit first), so a screen
  // reader hears them as they read on the page.
  const noteIds = [overLimit ? `${groupId}-over` : null, cut ? `${groupId}-cut` : null].filter(Boolean).join(" ");

  return (
    <>
      <FieldGroup kind="control" label="Rules text — top band" error={error} helper={STATION_TOP_BAND_HELP}>
        {(aria) => (
          <div className="flex flex-col gap-2">
            <RulesSymbolToolbar onInsert={onInsertSymbol} />
            <PipTextEditor
              ref={(handle) => {
                rulesTextRef.current = handle;
              }}
              name="station_intro"
              value={rows.intro}
              onChange={(next) => write({ ...rows, intro: next })}
              onBlur={() => {
                const next = tidy(rows.intro);
                if (next !== rows.intro) write({ ...rows, intro: next });
              }}
              aria-label={faceLabel ? `${faceLabel} rules text, top band` : "Rules text, top band"}
              aria-describedby={aria["aria-describedby"]}
              aria-invalid={Boolean(error)}
              placeholder="Flying, and the Station reminder."
              rows={4}
              className={textareaClass(Boolean(error))}
            />
            {!hasReminder ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                data-testid="station-add-reminder"
                onClick={() => {
                  const at = hasPt && plated >= 0 ? rows.tiers[plated]!.n : null;
                  const reminder = stationReminder(word, at);
                  write({ ...rows, intro: rows.intro.trim() ? `${rows.intro.replace(/\s+$/, "")}\n${reminder}` : reminder });
                }}
              >
                <Plus className="h-4 w-4" aria-hidden />
                Add the Station reminder
              </Button>
            ) : null}
          </div>
        )}
      </FieldGroup>

      <div
        role="group"
        aria-labelledby={`${groupId}-label`}
        aria-describedby={noteIds ? `${groupId}-help ${noteIds}` : `${groupId}-help`}
        className="flex flex-col gap-3"
        data-testid="station-tiers"
      >
        <div className="flex flex-col gap-1">
          <span id={`${groupId}-label`} className="text-xs font-semibold uppercase tracking-wider text-subtle">
            Tiers
          </span>
          <span id={`${groupId}-help`} className="text-xs text-muted">
            {STATION_TIERS_HELP}
            {hasPt && rows.tiers.length > 0 ? ` ${STATION_PT_HELP}` : ""}
          </span>
        </div>

        {rows.tiers.map((tier, i) => {
          const badNumber = thresholdOf(tier.input) === null;
          return (
            <div key={i} data-testid={`station-tier-${i}`} className="flex flex-col gap-2 rounded-lg border border-border bg-surface/40 p-3">
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <span className="whitespace-nowrap">Tier {i + 1} at</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={2}
                    value={tier.input}
                    aria-label={`Tier ${i + 1} charge counters`}
                    aria-invalid={badNumber}
                    aria-describedby={badNumber ? `${groupId}-n-${i}` : undefined}
                    ref={(node) => {
                      if (node && lastAdded.current === i) {
                        lastAdded.current = null;
                        node.focus();
                        node.select();
                      }
                    }}
                    onChange={(event) => {
                      const input = event.target.value.replace(/\D/g, "");
                      const n = thresholdOf(input);
                      setTier(i, n === null ? { input } : { input, n });
                    }}
                    onBlur={() => {
                      if (badNumber) setTier(i, { input: String(tier.n) });
                    }}
                    className={`${inputClass(badNumber)} h-11 shrink-0 text-center`}
                    style={{ width: "4.5rem" }}
                  />
                  <span aria-hidden>+</span>
                </label>
                {hasPt ? (
                  <label className="flex min-h-11 items-center gap-2 text-sm text-foreground">
                    <input
                      type="radio"
                      name={`${groupId}-pt`}
                      checked={plated === i}
                      onChange={() => setValue("station_pt_tier", i, { shouldDirty: true, shouldValidate: Boolean(errors.rules_text) })}
                      className="h-4 w-4 accent-[var(--color-primary)]"
                    />
                    <span>Power / toughness on this tier</span>
                  </label>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-auto min-h-11"
                  aria-label={`Remove tier ${i + 1}`}
                  onClick={() => {
                    setRefused(false);
                    write({ ...rows, tiers: rows.tiers.filter((_, at) => at !== i) }, ptChoiceAfterRemove(choice, i));
                  }}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                  Remove
                </Button>
              </div>
              {badNumber ? (
                <span id={`${groupId}-n-${i}`} role="alert" className="text-xs text-danger">
                  A tier&rsquo;s number is 1 to 99. The card keeps {tier.n}+ until you type one.
                </span>
              ) : null}
              <PipTextEditor
                name={`station_tier_${i}`}
                value={tier.text}
                onChange={(next) => setTier(i, { text: next })}
                onBlur={() => {
                  const next = tidy(tier.text);
                  if (next !== tier.text) setTier(i, { text: next });
                }}
                placeholder={i === 0 ? "Other creatures you control get +1/+1." : "Flying, lifelink"}
                rows={2}
                aria-label={`Tier ${i + 1} text`}
                className={textareaClass(false)}
              />
            </div>
          );
        })}

        {extra.length > 0 ? (
          <p role="status" data-testid="station-extra-tier" className="text-xs text-muted">
            This text has a fourth tier line ({extra.map((line) => `“${line.trim()}”`).join(", ")}). A card draws three tiers, so it
            stays in tier 3&rsquo;s text as typed — nothing is dropped.
          </p>
        ) : null}

        {overLimit ? (
          <p id={`${groupId}-over`} data-testid="station-over-limit" className="text-xs text-muted">
            {stationOverLimitNote(overLimit, thresholds)}
          </p>
        ) : null}
        {cut ? (
          <p id={`${groupId}-cut`} data-testid="station-text-cut" className="text-xs text-muted">
            {stationCutNote(cut, thresholds)}
          </p>
        ) : null}

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          data-testid="station-add-tier"
          aria-describedby={refused ? `${groupId}-limit` : undefined}
          onClick={() => {
            if (!canAddStationTier(rows.tiers)) {
              setRefused(true);
              return;
            }
            const n = nextThreshold(rows.tiers);
            lastAdded.current = rows.tiers.length;
            write({ ...rows, tiers: [...rows.tiers, { n, input: String(n), text: "" }] });
          }}
        >
          <Plus className="h-4 w-4" aria-hidden />
          Add tier
        </Button>
        {refused && !canAddStationTier(rows.tiers) ? (
          <p id={`${groupId}-limit`} role="alert" data-testid="station-tier-limit" className="text-xs text-danger">
            {STATION_TIER_LIMIT_NOTE}
          </p>
        ) : null}
      </div>
    </>
  );
}
