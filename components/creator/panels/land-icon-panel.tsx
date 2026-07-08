"use client";

// Land icon panel — the Text & stats step for BASIC lands. Basics print a
// large mana symbol instead of rules text, so the step's only job is the
// icon: it follows the land type automatically (Forest → {G}), and the user
// can override it with another symbol or upload their own mark. Overrides
// write the card's `watermark` (size "large"); the automatic state stores
// nothing — both renderers derive it from the basic subtype
// (lib/cards/watermark.ts resolveWatermark).

import { useRef, useState } from "react";
import { Controller, useFormContext } from "react-hook-form";
import { Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ChipGroup, type ChipOption } from "@/components/ui/chip-group";
import { FieldGroup } from "@/components/creator/field-group";
import { uploadWatermarkServerAction } from "@/lib/cards/upload-watermark-server";
import { WATERMARK_INK } from "@/lib/cards/watermark";
import type { FormValues, WatermarkFormValues } from "@/lib/creator/form-types";

const MANA_KEYS = [
  { key: "w", label: "Plains" },
  { key: "u", label: "Island" },
  { key: "b", label: "Swamp" },
  { key: "r", label: "Mountain" },
  { key: "g", label: "Forest" },
  { key: "c", label: "Wastes" },
] as const;

type LandIconPanelProps = {
  userId: string | null;
  /** The symbol the basic subtype produces automatically ("g" for Forest) —
   *  shown as the selection when no explicit override is stored. */
  autoKey: "w" | "u" | "b" | "r" | "g" | "c";
};

export function LandIconPanel({ userId, autoKey }: LandIconPanelProps) {
  const { control } = useFormContext<FormValues>();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  return (
    <Controller
      control={control}
      name="watermark"
      render={({ field }) => {
        const wm = field.value as WatermarkFormValues;
        const clearOverride = () =>
          field.onChange({ kind: "", key: "", url: "", size: "normal", opacity: null });

        const onFilePicked = async (file: File | undefined) => {
          if (!file) return;
          setUploading(true);
          try {
            const formData = new FormData();
            formData.append("file", file);
            const result = await uploadWatermarkServerAction(formData);
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            field.onChange({
              kind: "custom",
              key: "",
              url: result.publicUrl,
              size: "large",
              opacity: null,
            });
            toast.success("Icon uploaded.");
          } finally {
            setUploading(false);
            if (fileRef.current) fileRef.current.value = "";
          }
        };

        // The effective selection: an explicit mana override, else the
        // subtype's automatic symbol (custom uploads show via the row below).
        const selected =
          wm.kind === "mana" ? wm.key : wm.kind === "" ? autoKey : "";

        const options: ChipOption<string>[] = MANA_KEYS.map((m) => ({
          value: m.key,
          label: m.label,
          description: m.key === autoKey ? "Matches the land type" : undefined,
          leading: (
            <i
              className={`ms ms-${m.key}`}
              aria-hidden
              style={{ fontSize: 18, color: WATERMARK_INK }}
            />
          ),
        }));

        return (
          <FieldGroup
            label="Land icon"
            helper="Basic lands print a large mana symbol instead of rules text. It follows the land type automatically — pick a different symbol to override it, or upload your own mark."
          >
            <div className="flex flex-col gap-3">
              <ChipGroup
                ariaLabel="Land icon"
                layout="grid-3"
                value={selected}
                onChange={(key) => {
                  if (key === autoKey) {
                    // Picking the type's own symbol = back to automatic.
                    clearOverride();
                    return;
                  }
                  field.onChange({
                    kind: "mana",
                    key,
                    url: "",
                    size: "large",
                    opacity: null,
                  });
                }}
                options={options}
              />

              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/webp"
                  className="sr-only"
                  aria-label="Upload a custom land icon"
                  onChange={(e) => void onFilePicked(e.target.files?.[0])}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!userId || uploading}
                  title={userId ? undefined : "Sign in to upload an icon."}
                  onClick={() => fileRef.current?.click()}
                >
                  {uploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Upload className="h-4 w-4" aria-hidden />
                  )}
                  {wm.kind === "custom" ? "Replace custom icon" : "Upload custom icon"}
                </Button>
                {wm.kind === "custom" && wm.url ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={wm.url}
                      alt="Custom land icon"
                      className="h-8 w-8 rounded border border-border/60 object-contain"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={clearOverride}
                    >
                      <X className="h-4 w-4" aria-hidden />
                      Remove
                    </Button>
                  </>
                ) : null}
                <span className="text-[11px] text-subtle">
                  PNG/WebP with transparency · up to 2 MB
                </span>
              </div>

              <p className="text-[11px] text-subtle">
                Want rules text instead? Remove the basic land subtype
                (Plains, Island, Swamp, Mountain, Forest, Wastes) on the
                Identity step.
              </p>
            </div>
          </FieldGroup>
        );
      }}
    />
  );
}
