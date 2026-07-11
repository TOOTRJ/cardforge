"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useUpgradeModal } from "@/components/billing/upgrade-modal-provider";
import { updateExportWatermarkAction } from "@/lib/account/actions";

// ---------------------------------------------------------------------------
// ExportWatermarkPanel — the settings surface for the paid custom footer
// mark (profiles.export_watermark_text). Paid users type a short line that
// prints in their cards' footer (bottom line, next to the artist credit) on
// previews and exports; free users see a disabled input + upsell.
// ---------------------------------------------------------------------------

type ExportWatermarkPanelProps = {
  initialText: string | null;
  canCustomize: boolean;
};

export function ExportWatermarkPanel({
  initialText,
  canCustomize,
}: ExportWatermarkPanelProps) {
  const router = useRouter();
  const upgrade = useUpgradeModal();
  const [text, setText] = useState(initialText ?? "");
  const [isPending, startTransition] = useTransition();

  const save = () => {
    startTransition(async () => {
      const result = await updateExportWatermarkAction({ text });
      if (result.ok) {
        toast.success(
          text.trim()
            ? "Watermark saved — it prints on your cards from now on."
            : "Watermark cleared.",
        );
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
          Footer text
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={40}
            disabled={!canCustomize || isPending}
            placeholder="e.g. yourname.art"
            className="h-10 w-full max-w-xs rounded-md border border-border bg-background/60 px-3 text-sm text-foreground placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60"
          />
          {canCustomize ? (
            <Button size="sm" onClick={save} disabled={isPending}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          ) : null}
        </div>
      </label>
      <p className="text-xs leading-5 text-muted">
        Prints in your cards&apos; footer — the bottom line, next to the artist
        credit — on previews and exports. Up to 40 characters; leave blank for
        no mark.
      </p>
      {!canCustomize ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/60 bg-background/40 px-4 py-3">
          <p className="text-xs leading-5 text-muted">
            Custom watermarks are part of a paid plan — the free plan prints
            the PipGlyph mark instead.
          </p>
          <Button size="sm" onClick={() => upgrade.open("hi_res_export")}>
            Upgrade
          </Button>
        </div>
      ) : null}
    </div>
  );
}
