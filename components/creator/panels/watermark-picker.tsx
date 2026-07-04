"use client";

// Design-watermark picker — the faint mark behind the rules text. Lives in
// the Publish step's Advanced section next to Finish. "None" is the default;
// mana symbols render from the mana font (no assets), presets from
// public/watermarks/, and custom uploads go through the hardened
// upload-watermark-server action (2 MB, png/webp only).

import { useRef, useState } from "react";
import { Controller, useFormContext } from "react-hook-form";
import { Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ChipGroup, type ChipOption } from "@/components/ui/chip-group";
import { FieldGroup } from "@/components/creator/field-group";
import { uploadWatermarkServerAction } from "@/lib/cards/upload-watermark-server";
import { WATERMARK_PRESETS } from "@/lib/cards/watermark";
import { hidesCost } from "@/lib/creator/steps";
import type { FormValues, WatermarkFormValues } from "@/lib/creator/form-types";

const MANA_KEYS = [
  { key: "w", label: "White" },
  { key: "u", label: "Blue" },
  { key: "b", label: "Black" },
  { key: "r", label: "Red" },
  { key: "g", label: "Green" },
  { key: "c", label: "Colorless" },
] as const;

type WatermarkPickerProps = {
  userId: string | null;
};

export function WatermarkPicker({ userId }: WatermarkPickerProps) {
  const { control, setValue, watch } = useFormContext<FormValues>();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const template = watch("frame_style.template");
  // The "large" (basic-land big symbol) treatment only makes sense where
  // there's a whole text box to fill — offer the toggle on land frames.
  const isLandish = hidesCost(template);

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
      setValue(
        "watermark",
        { kind: "custom", key: "", url: result.publicUrl, size: "normal" },
        { shouldDirty: true },
      );
      toast.success("Watermark uploaded.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <Controller
      control={control}
      name="watermark"
      render={({ field }) => {
        const wm = field.value as WatermarkFormValues;
        const set = (next: Partial<WatermarkFormValues>) =>
          field.onChange({ ...wm, ...next });

        const manaOptions: ChipOption<string>[] = MANA_KEYS.map((m) => ({
          value: `mana:${m.key}`,
          label: m.label,
          leading: (
            <i
              className={`ms ms-${m.key}`}
              aria-hidden
              style={{ fontSize: 18, color: "#3b3126" }}
            />
          ),
        }));
        const presetOptions: ChipOption<string>[] = WATERMARK_PRESETS.map(
          (p) => ({
            value: `preset:${p.key}`,
            label: p.label,
            leading: (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/watermarks/${p.key}.png`}
                alt=""
                className="h-5 w-5 object-contain opacity-70"
              />
            ),
          }),
        );

        const selected =
          wm.kind === "mana" || wm.kind === "preset"
            ? `${wm.kind}:${wm.key}`
            : "";

        const pick = (value: string) => {
          const [kind, key] = value.split(":");
          if (selected === value) {
            // Re-clicking the active chip clears the watermark.
            field.onChange({ kind: "", key: "", url: "", size: "normal" });
            return;
          }
          set({ kind: kind as "mana" | "preset", key, url: "" });
        };

        return (
          <FieldGroup
            label="Watermark"
            helper="A faint mark behind the rules text — a mana symbol, a PipGlyph faction mark, or your own transparent PNG. Click the active mark again to remove it."
          >
            <div className="flex flex-col gap-3">
              <ChipGroup
                ariaLabel="Mana symbol watermark"
                layout="grid-3"
                value={selected}
                onChange={pick}
                options={manaOptions}
              />
              <ChipGroup
                ariaLabel="Preset watermark"
                layout="grid-2"
                value={selected}
                onChange={pick}
                options={presetOptions}
              />

              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/webp"
                  className="sr-only"
                  aria-label="Upload a custom watermark"
                  onChange={(e) => void onFilePicked(e.target.files?.[0])}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!userId || uploading}
                  title={userId ? undefined : "Sign in to upload a watermark."}
                  onClick={() => fileRef.current?.click()}
                >
                  {uploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Upload className="h-4 w-4" aria-hidden />
                  )}
                  {wm.kind === "custom" ? "Replace custom mark" : "Upload custom mark"}
                </Button>
                {wm.kind === "custom" && wm.url ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={wm.url}
                      alt="Custom watermark"
                      className="h-8 w-8 rounded border border-border/60 object-contain"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        field.onChange({ kind: "", key: "", url: "", size: "normal" })
                      }
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

              {isLandish && wm.kind !== "" ? (
                <label className="flex items-center gap-2 text-sm text-muted">
                  <input
                    type="checkbox"
                    checked={wm.size === "large"}
                    onChange={(e) =>
                      set({ size: e.target.checked ? "large" : "normal" })
                    }
                  />
                  Large (the classic basic-land big-symbol treatment)
                </label>
              ) : null}
            </div>
          </FieldGroup>
        );
      }}
    />
  );
}
