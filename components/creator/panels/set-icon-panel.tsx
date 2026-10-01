"use client";

// Set & collector info panel — the "Set & collector info" step. Two groups:
//
//   1. The set SYMBOL. Writes the card's denormalized symbol columns
//      (set_icon_url / set_icon_code) directly: the default PipGlyph mark, a
//      preset Keyrune glyph, or an uploaded image. Rarity tinting previews
//      live against the card's current rarity. This is the symbol's only
//      input path (the sets feature was removed 2026-09-22).
//
//   2. The COLLECTOR fields (TODO 4.9a, migration 0133): the PRINTED set
//      code, the collector number and the printing's language — what a
//      printing's collector line says, stored as card data. Nothing draws
//      them yet (4.9b's collector line is opt-in per card). The Scryfall
//      import fills them from the printing; here the owner edits them on
//      any card (content, like the symbol — lib/creator/revise.ts). A
//      Keyrune symbol offers its code as a one-click "Use DMU" suggestion,
//      never written on its own (4.9 decision D2: new cards print only
//      what's filled); an imported card with empty fields offers "Fill from
//      the printing" — one Scryfall lookup through /api/scryfall/named,
//      into the form, saved like any edit (no bulk backfill: 0108's
//      updated_at guard would churn the sitemap and OG cache-buster).

import { useRef, useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { FieldGroup, inputClass } from "@/components/creator/field-group";
import { SetSymbol } from "@/components/cards/set-symbol";
import {
  COLLECTOR_NUMBER_MAX,
  PRINTED_LANGS,
  SET_CODE_MAX,
  isCardLang,
} from "@/lib/cards/collector-fields";
import { cardTypeHasRarity } from "@/lib/cards/emblem";
import { kindFromCard, kindHidesRarity } from "@/lib/creator/card-kinds";
import { uploadCoverImage } from "@/lib/media/upload-cover";
import type { ScryfallImportPatch } from "@/lib/scryfall/import-mapper";
import { cn } from "@/lib/utils";
import type { Rarity } from "@/types/card";
import type { FormValues } from "@/lib/creator/form-types";

// A curated set of recognizable Keyrune set-symbol codes (same list as the
// picker). The full Keyrune library has hundreds; these cover popular
// real-world sets.
const PRESET_SET_CODES = [
  "dom",
  "war",
  "eld",
  "thb",
  "iko",
  "znr",
  "khm",
  "stx",
  "afr",
  "mid",
  "neo",
  "dmu",
];

export function SetIconPanel({ userId }: { userId: string | null }) {
  const { control, setValue } = useFormContext<FormValues>();
  const iconUrl = useWatch({ control, name: "set_icon_url" }) ?? "";
  const iconCode = useWatch({ control, name: "set_icon_code" }) ?? "";
  const rarity = (useWatch({ control, name: "rarity" }) || null) as
    | Rarity
    | null;
  const cardType = useWatch({ control, name: "card_type" });
  const template = useWatch({ control, name: "frame_style.template" });
  // A token or an emblem has no rarity chips, so the helper doesn't send the
  // user to them; an emblem has no rarity at all (CR 114, TODO 6.23), so its
  // symbol's label names none, as on the card preview.
  const rarityFixed = kindHidesRarity(kindFromCard(cardType, template));

  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  const apply = (next: { iconUrl: string; iconCode: string }) => {
    setValue("set_icon_url", next.iconUrl, { shouldDirty: true });
    setValue("set_icon_code", next.iconCode, { shouldDirty: true });
  };

  const handleFile = async (file: File) => {
    if (!userId) {
      toast.error("You need to be signed in to upload an icon.");
      return;
    }
    setUploading(true);
    try {
      const result = await uploadCoverImage(userId, file);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      apply({ iconUrl: result.publicUrl, iconCode: "" });
      toast.success("Icon uploaded.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const usingDefault = !iconUrl && !iconCode;

  return (
    <div className="flex flex-col gap-6">
      <FieldGroup
        label="Set icon"
        helper={
          rarityFixed
            ? "The small symbol at the right end of the type line."
            : "The small symbol at the right end of the type line. It takes the card's rarity color — try switching rarity on the Text & stats step to see it change."
        }
      >
        <div className="flex flex-col gap-4">
          {/* Current selection preview at type-line-ish size + larger detail. */}
          <div className="flex items-center gap-3">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border border-border bg-elevated/50">
              <SetSymbol
                rarity={rarity ?? "rare"}
                namesRarity={cardTypeHasRarity(cardType)}
                iconUrl={iconUrl || null}
                setCode={iconCode || null}
                size={34}
              />
            </span>
            <span className="text-xs leading-5 text-muted">
              {usingDefault ? (
                <>
                  Using the default <strong>PipGlyph mark</strong> — the Astral
                  Rose seal, tinted by rarity.
                </>
              ) : iconUrl ? (
                "Using your uploaded icon."
              ) : (
                <>
                  Using the <strong>{iconCode.toUpperCase()}</strong> preset
                  glyph.
                </>
              )}
            </span>
          </div>

          {/* Preset Keyrune glyphs. */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] uppercase tracking-wider text-subtle">
              Pick a preset symbol
            </span>
            <div className="flex flex-wrap gap-2">
              {PRESET_SET_CODES.map((code) => {
                const active = !iconUrl && iconCode === code;
                return (
                  <button
                    key={code}
                    type="button"
                    aria-pressed={active}
                    onClick={() => apply({ iconUrl: "", iconCode: code })}
                    title={code.toUpperCase()}
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-md border text-lg transition-colors",
                      active
                        ? "border-primary bg-primary/15 text-primary-bright"
                        : "border-border bg-elevated/50 text-muted hover:border-border-strong hover:text-foreground",
                    )}
                  >
                    <i className={cn("ss", `ss-${code}`, "ss-grad")} aria-hidden />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Upload / reset. */}
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="sr-only"
              aria-label="Upload set icon"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
            <button
              type="button"
              disabled={!userId || uploading}
              onClick={() => inputRef.current?.click()}
              className="inline-flex h-9 items-center rounded-md border border-border bg-elevated/50 px-3 text-xs font-medium text-foreground transition-colors hover:border-border-strong disabled:opacity-60"
            >
              {uploading ? "Uploading…" : "Upload your own"}
            </button>
            {!usingDefault ? (
              <button
                type="button"
                onClick={() => apply({ iconUrl: "", iconCode: "" })}
                className="inline-flex h-9 items-center rounded-md px-3 text-xs text-muted transition-colors hover:text-foreground"
              >
                Use the default mark
              </button>
            ) : null}
          </div>
        </div>
      </FieldGroup>

      <CollectorInfoFields />
    </div>
  );
}

/** The /named route's answer, as far as this panel reads it. */
type NamedResponse =
  | { ok: true; patch: Pick<ScryfallImportPatch, "collector"> }
  | { ok: false; error?: string };

const SECONDARY_BUTTON =
  "inline-flex h-9 items-center rounded-md border border-border bg-elevated/50 px-3 text-xs font-medium text-foreground transition-colors hover:border-border-strong disabled:opacity-60";

/**
 * The collector fields (TODO 4.9a): set code, collector number, language.
 * Exported for the panel tests; the step renders it under the symbol.
 */
export function CollectorInfoFields() {
  const {
    control,
    register,
    setValue,
    formState: { errors },
  } = useFormContext<FormValues>();
  const iconCode = useWatch({ control, name: "set_icon_code" }) ?? "";
  const setCode = useWatch({ control, name: "set_code" }) ?? "";
  const collectorNumber = useWatch({ control, name: "collector_number" }) ?? "";
  const lang = useWatch({ control, name: "lang" }) ?? "";
  const sourceScryfallId = (useWatch({ control, name: "source_scryfall_id" }) ?? "").trim();
  const [filling, setFilling] = useState(false);

  // The Keyrune code as a suggestion — offered, never written by itself.
  const suggestion = iconCode.trim() && !setCode.trim() ? iconCode.trim().toUpperCase() : null;
  // A stored language with no printed code (he, la, grc, ar, sa, qya) shows
  // as "Other (not printed)" so the select never silently swaps it.
  const printed = PRINTED_LANGS.some((entry) => entry.code === lang);
  const unprintedStored = !printed && isCardLang(lang) ? lang : null;
  // An imported card that still has empty fields: offer the printing's.
  const canFill = Boolean(sourceScryfallId) && (!setCode.trim() || !collectorNumber.trim());

  const fillFromPrinting = async () => {
    setFilling(true);
    try {
      const response = await fetch(
        `/api/scryfall/named?${new URLSearchParams({ id: sourceScryfallId })}`,
      );
      const body = (await response.json().catch(() => null)) as NamedResponse | null;
      if (!body || body.ok !== true) {
        toast.error(
          (body && "error" in body && body.error) || "Couldn't look up the printing.",
        );
        return;
      }
      const collector = body.patch.collector;
      if (!collector) {
        toast.error("Scryfall didn't answer for this printing's set — try again in a moment.");
        return;
      }
      setValue("set_code", collector.set_code ?? "", { shouldDirty: true });
      setValue("collector_number", collector.collector_number ?? "", { shouldDirty: true });
      setValue("lang", collector.lang, { shouldDirty: true });
      toast.success("Filled from the printing — save to keep it.");
    } catch {
      toast.error("Couldn't look up the printing.");
    } finally {
      setFilling(false);
    }
  };

  return (
    <div className="flex flex-col gap-4" data-testid="collector-info">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
          Collector info
        </span>
        <span className="text-xs text-muted">
          What a printing&apos;s bottom line says: its set code, collector number and
          language. Stored with the card; an import fills them from the real printing.
        </span>
      </div>

      {canFill ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-elevated/30 px-3 py-2">
          <span className="text-xs text-muted">
            This card started from a real printing.
          </span>
          <button
            type="button"
            disabled={filling}
            onClick={fillFromPrinting}
            className={SECONDARY_BUTTON}
          >
            {filling ? "Looking up…" : "Fill from the printing"}
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* The suggestion sits OUTSIDE the FieldGroup's <label>: a button
            inside one would take the label's text as its accessible name
            (and lend its own to the input's). */}
        <div className="flex flex-col gap-2">
          <FieldGroup
            label="Set code"
            helper="2–6 letters or digits, as printed (a token prints its parent set's code)."
            error={errors.set_code?.message}
          >
            <input
              {...register("set_code")}
              placeholder="DMU"
              maxLength={SET_CODE_MAX}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className={cn(inputClass(Boolean(errors.set_code)), "uppercase")}
            />
          </FieldGroup>
          {suggestion ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted">Your set symbol is {suggestion}.</span>
              <button
                type="button"
                onClick={() => setValue("set_code", suggestion, { shouldDirty: true })}
                className={cn(SECONDARY_BUTTON, "h-8 shrink-0 whitespace-nowrap")}
              >
                Use {suggestion}
              </button>
            </div>
          ) : null}
        </div>

        <FieldGroup
          label="Collector number"
          helper="As printed: 107, 107/281, 237a…"
          error={errors.collector_number?.message}
        >
          <input
            {...register("collector_number")}
            placeholder="107/281"
            maxLength={COLLECTOR_NUMBER_MAX}
            autoComplete="off"
            spellCheck={false}
            className={inputClass(Boolean(errors.collector_number))}
          />
        </FieldGroup>
      </div>

      <FieldGroup
        label="Language"
        helper="The printing's language. Twelve have a printed code; any other is kept but prints nothing."
        error={errors.lang?.message}
      >
        <select {...register("lang")} className={inputClass(Boolean(errors.lang))}>
          {PRINTED_LANGS.map((entry) => (
            <option key={entry.code} value={entry.code}>
              {entry.label} ({entry.printed})
            </option>
          ))}
          {unprintedStored ? (
            <option value={unprintedStored}>Other (not printed) — {unprintedStored}</option>
          ) : null}
        </select>
      </FieldGroup>
    </div>
  );
}
