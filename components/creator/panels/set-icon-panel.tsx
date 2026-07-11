"use client";

// Set icon panel — the "Set icon" step. Writes the card's denormalized
// symbol columns (set_icon_url / set_icon_code) directly: the default
// PipGlyph mark, a preset Keyrune glyph, or an uploaded image. Rarity
// tinting previews live against the card's current rarity. Replaces the
// set-membership picker as the icon's input path while the sets feature
// is hidden (lib/sets/flags.ts).

import { useRef, useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { FieldGroup } from "@/components/creator/field-group";
import { SetSymbol } from "@/components/cards/set-symbol";
import { uploadSetCover } from "@/lib/sets/upload-cover";
import { cn } from "@/lib/utils";
import type { Rarity } from "@/types/card";
import type { FormValues } from "@/lib/creator/form-types";

// A curated set of recognizable Keyrune set-symbol codes (same list as the
// set editor's picker). The full Keyrune library has hundreds; these cover
// popular sets.
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
      const result = await uploadSetCover(userId, file);
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
    <FieldGroup
      label="Set icon"
      helper="The small symbol at the right end of the type line. It takes the card's rarity color — try switching rarity on the Identity step to see it change."
    >
      <div className="flex flex-col gap-4">
        {/* Current selection preview at type-line-ish size + larger detail. */}
        <div className="flex items-center gap-3">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border border-border bg-elevated/50">
            <SetSymbol
              rarity={rarity ?? "rare"}
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
  );
}
