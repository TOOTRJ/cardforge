"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  deleteCustomPipAction,
  saveCustomPipAction,
} from "@/lib/pips/actions";
import {
  CUSTOM_PIP_SYMBOLS,
  CUSTOM_PIP_SYMBOL_LABELS,
  type CustomPipSymbol,
  type PipOverrides,
} from "@/lib/pips/override";

// ---------------------------------------------------------------------------
// CustomPipsManager — the six core-symbol slots with upload/replace/remove.
// Shared by the creator's "Customize pips" dialog and the settings panel.
//
// Uploading swaps the ICON everywhere the owner's cost pips render (picker,
// live preview, exports); removing reverts to the standard mana-font glyph.
// Server truth flows back via router.refresh() → updated pipOverrides prop.
// ---------------------------------------------------------------------------

type CustomPipsManagerProps = {
  overrides: PipOverrides;
  className?: string;
};

export function CustomPipsManager({
  overrides,
  className,
}: CustomPipsManagerProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-2 sm:grid-cols-3",
        className,
      )}
    >
      {CUSTOM_PIP_SYMBOLS.map((symbol) => (
        <PipSlot
          key={symbol}
          symbol={symbol}
          overrideUrl={overrides[symbol] ?? null}
        />
      ))}
    </div>
  );
}

function PipSlot({
  symbol,
  overrideUrl,
}: {
  symbol: CustomPipSymbol;
  overrideUrl: string | null;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  // Optimistic thumbnail while the round-trip completes, so the slot doesn't
  // flash the old icon between upload and router.refresh(). `supersedes`
  // pins the override the preview replaced: once refresh() delivers a
  // DIFFERENT override (a replacement is always a new ?v= url), the derived
  // shownUrl switches to the server truth with no state write needed.
  const [optimistic, setOptimistic] = useState<{
    url: string;
    supersedes: string | null;
  } | null>(null);

  // Release the blob only once it's no longer referenced — replaced by a
  // newer pick, cleared, or on unmount. Revoking inside the save transition
  // (while the URL was still the rendered src) blanked the slot until the
  // refreshed override arrived.
  useEffect(() => {
    if (!optimistic) return;
    return () => URL.revokeObjectURL(optimistic.url);
  }, [optimistic]);

  const label = CUSTOM_PIP_SYMBOL_LABELS[symbol];
  const shownUrl =
    optimistic && overrideUrl === optimistic.supersedes
      ? optimistic.url
      : overrideUrl;

  const onFilePicked = (file: File | undefined) => {
    if (!file) return;
    const formData = new FormData();
    formData.set("symbol", symbol);
    formData.set("file", file);
    setOptimistic({ url: URL.createObjectURL(file), supersedes: overrideUrl });
    startTransition(async () => {
      const result = await saveCustomPipAction(formData);
      if (result.ok) {
        toast.success(`Custom ${label.toLowerCase()} pip saved.`);
        router.refresh();
      } else {
        setOptimistic(null);
        toast.error(result.error);
      }
    });
  };

  const onRemove = () => {
    startTransition(async () => {
      const result = await deleteCustomPipAction(symbol);
      if (result.ok) {
        setOptimistic(null);
        toast.success(`${label} pip reset to standard.`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-elevated/40 p-2.5">
      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center">
        {shownUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={shownUrl}
            alt={`Custom ${label.toLowerCase()} pip`}
            className="h-8 w-8 rounded-full object-cover shadow-[-1px_2px_0_#111]"
          />
        ) : (
          <i
            className={`ms ms-${symbol.toLowerCase()} ms-cost ms-shadow`}
            aria-hidden
            style={{ fontSize: 26 }}
          />
        )}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-xs font-medium text-foreground">{label}</span>
        <span className="text-[10px] uppercase tracking-wider text-subtle">
          {shownUrl ? "Custom" : "Standard"}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          aria-label={`Upload custom ${label.toLowerCase()} mana pip`}
          onChange={(e) => {
            onFilePicked(e.target.files?.[0]);
            // Allow re-selecting the same file after a failed attempt.
            e.target.value = "";
          }}
        />
        <button
          type="button"
          disabled={pending}
          onClick={() => fileRef.current?.click()}
          aria-label={`${shownUrl ? "Replace" : "Upload"} custom ${label.toLowerCase()} mana pip`}
          title={shownUrl ? "Replace" : "Upload"}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/40 bg-elevated/60 text-muted transition-colors hover:border-border-strong hover:text-foreground disabled:opacity-40"
        >
          <Upload className="h-3.5 w-3.5" aria-hidden />
        </button>
        {shownUrl ? (
          <button
            type="button"
            disabled={pending}
            onClick={onRemove}
            aria-label={`Remove custom ${label.toLowerCase()} mana pip`}
            title="Reset to standard"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/40 bg-elevated/60 text-muted transition-colors hover:border-danger/60 hover:text-danger disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </button>
        ) : null}
      </div>
    </div>
  );
}
