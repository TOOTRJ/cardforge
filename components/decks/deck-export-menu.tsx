"use client";

import { useState } from "react";
import {
  ClipboardCopy,
  Download,
  FileText,
  Image as ImageIcon,
  Loader2,
  Package,
  Printer,
  ScrollText,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useUpgradeModal } from "@/components/billing/upgrade-modal-provider";
import { useDeckExport } from "@/components/decks/deck-export-provider";
import { APPROX_BYTES_PER_CARD, formatBytes, type DeckExportQuality } from "@/lib/decks/export-client";
import type { DeckPdfLayout } from "@/lib/render/card-pdf";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// DeckExportMenu — the deck owner's export hub (Pro). Two builds, both run
// in the background by DeckExportProvider with a progress card:
//   Deck ZIP   — clean card images (HD or standard), cover, deck.pdf report
//                (stats, decklist, AI guide + combos), decklist.txt
//   Print PDF  — one card per page, or 3×3 proxy sheets (Letter / A4) with
//                crop marks; real cards land on a checklist page
// plus the free copy-as-text buttons. A free/Plus owner never sees this
// dialog: the Export button opens the upgrade modal straight away (owner
// decision 2026-09-15).
// ---------------------------------------------------------------------------

type DeckExportMenuProps = {
  deckId: string;
  deckSlug: string;
  /** Precomputed decklist text variants (see lib/decks/export-text.ts). */
  arenaText: string;
  plainText: string;
  /** Whether the viewer's plan includes batch export (Pro). */
  allowBatchExport: boolean;
  /** Unique custom (remixed) cards — what gets rendered. */
  customCardCount: number;
  /** Entries without a custom proxy — listed, not printed. */
  realCardCount: number;
  hasCover: boolean;
};

const QUALITY_OPTIONS: Array<{ value: DeckExportQuality; label: string; detail: string }> = [
  { value: "hd", label: "HD", detail: "1500 × 2100 · print quality" },
  { value: "default", label: "Standard", detail: "750 × 1050 · sharing & screens" },
];

const LAYOUT_OPTIONS: Array<{ value: DeckPdfLayout; label: string; detail: string }> = [
  { value: "pages", label: "One per page", detail: "2.5 × 3.5 in, one card each" },
  { value: "sheet-letter", label: "3×3 sheets · Letter", detail: "9 up with crop marks" },
  { value: "sheet-a4", label: "3×3 sheets · A4", detail: "9 up with crop marks" },
];

export function DeckExportMenu({
  deckId,
  deckSlug,
  arenaText,
  plainText,
  allowBatchExport,
  customCardCount,
  realCardCount,
  hasCover,
}: DeckExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [quality, setQuality] = useState<DeckExportQuality>("hd");
  const [layout, setLayout] = useState<DeckPdfLayout>("pages");
  const upgrade = useUpgradeModal();
  const exporter = useDeckExport();

  const copyText = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied to your clipboard.`);
    } catch {
      toast.error("Couldn't access the clipboard.");
    }
  };

  if (!allowBatchExport) {
    return (
      <Button variant="outline" type="button" onClick={() => upgrade.open("deck_export")}>
        <Download className="h-4 w-4" aria-hidden /> Export
        <ProBadge />
      </Button>
    );
  }

  const startExport = (kind: "zip" | "pdf") => {
    exporter.start({ deckId, kind, quality, layout });
    setOpen(false);
  };

  const zipEstimate = formatBytes(customCardCount * APPROX_BYTES_PER_CARD[quality] + (hasCover ? 400 * 1024 : 0) + 60 * 1024);
  const minutesEstimate = Math.max(1, Math.ceil((customCardCount * 2.5) / 60));
  const busy = exporter.busy;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
          Export
        </Button>
      </DialogTrigger>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Export this deck</DialogTitle>
          <DialogDescription>
            Exports build in the background — start one, keep browsing, and watch the progress card at the bottom right.
            {customCardCount > 0 ? (
              <> Every card renders clean at full resolution, so {customCardCount} card{customCardCount === 1 ? "" : "s"} takes about {minutesEstimate} minute{minutesEstimate === 1 ? "" : "s"}.</>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        {busy ? (
          <div className="flex items-center gap-3 rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-foreground">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" aria-hidden />
            <span className="flex-1">An export is already running. It has to finish before another starts.</span>
            <Button type="button" size="sm" variant="outline" onClick={() => { setOpen(false); exporter.openDetails(); }}>
              View progress
            </Button>
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          {/* Deck ZIP */}
          <section className="flex flex-col gap-4 rounded-xl border border-gold/30 bg-gold/5 p-5">
            <header className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gold/15 text-gold">
                <Package className="h-5 w-5" aria-hidden />
              </span>
              <div className="flex flex-col gap-0.5">
                <h3 className="text-base font-semibold text-foreground">Deck package · ZIP</h3>
                <p className="text-xs leading-5 text-muted">Everything about the deck in one download.</p>
              </div>
            </header>
            <ul className="grid gap-1.5 text-sm text-muted">
              <Included icon={ImageIcon}>
                {customCardCount} clean card image{customCardCount === 1 ? "" : "s"}, no watermark
              </Included>
              <Included icon={ScrollText}>deck.pdf — stats, decklist, how to play &amp; combos</Included>
              <Included icon={FileText}>decklist.txt</Included>
              {hasCover ? <Included icon={Sparkles}>Cover art</Included> : null}
            </ul>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-subtle">Image size</legend>
              <div className="grid grid-cols-2 gap-2">
                {QUALITY_OPTIONS.map((option) => (
                  <ChoiceTile
                    key={option.value}
                    name="export-quality"
                    checked={quality === option.value}
                    onChange={() => setQuality(option.value)}
                    label={option.label}
                    detail={option.detail}
                  />
                ))}
              </div>
            </fieldset>
            <div className="mt-auto flex items-center justify-between gap-3">
              <span className="text-xs tabular-nums text-subtle">≈ {zipEstimate}</span>
              <Button type="button" disabled={busy || (customCardCount === 0 && realCardCount === 0)} onClick={() => startExport("zip")}>
                <Download className="h-4 w-4" aria-hidden />
                Build ZIP
              </Button>
            </div>
          </section>

          {/* Print PDF */}
          <section className="flex flex-col gap-4 rounded-xl border border-border/70 bg-elevated/30 p-5">
            <header className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-elevated text-foreground">
                <Printer className="h-5 w-5" aria-hidden />
              </span>
              <div className="flex flex-col gap-0.5">
                <h3 className="text-base font-semibold text-foreground">Print proxies · PDF</h3>
                <p className="text-xs leading-5 text-muted">
                  Your custom cards at true 2.5 × 3.5 in. Sheets repeat each card by its deck quantity.
                </p>
              </div>
            </header>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-subtle">Layout</legend>
              <div className="grid gap-2">
                {LAYOUT_OPTIONS.map((option) => (
                  <ChoiceTile
                    key={option.value}
                    name="export-layout"
                    checked={layout === option.value}
                    onChange={() => setLayout(option.value)}
                    label={option.label}
                    detail={option.detail}
                  />
                ))}
              </div>
            </fieldset>
            {realCardCount > 0 ? (
              <p className="text-xs leading-5 text-subtle">
                {realCardCount} real card{realCardCount === 1 ? "" : "s"} without a custom proxy go on a checklist page instead of printing.
              </p>
            ) : null}
            <div className="mt-auto flex items-center justify-end">
              <Button type="button" variant="outline" disabled={busy || (customCardCount === 0 && realCardCount === 0)} onClick={() => startExport("pdf")}>
                <Printer className="h-4 w-4" aria-hidden />
                Build PDF
              </Button>
            </div>
          </section>
        </div>

        <section className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-subtle">Copy decklist</span>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => copyText("Arena decklist", arenaText)}>
              <ClipboardCopy className="h-3.5 w-3.5" aria-hidden />
              Arena format
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => copyText("Decklist", plainText)}>
              <FileText className="h-3.5 w-3.5" aria-hidden />
              Plain text
            </Button>
          </div>
        </section>
        <span className="sr-only">{deckSlug}</span>
      </DialogContent>
    </Dialog>
  );
}

function Included({ icon: Icon, children }: { icon: typeof ImageIcon; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 shrink-0 text-gold" aria-hidden />
      <span>{children}</span>
    </li>
  );
}

function ChoiceTile({
  name,
  checked,
  onChange,
  label,
  detail,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  label: string;
  detail: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer flex-col gap-0.5 rounded-lg border px-3 py-2 transition-colors",
        checked
          ? "border-primary-bright/60 bg-primary/10"
          : "border-border/60 bg-surface/40 hover:border-border hover:bg-elevated/60",
      )}
    >
      <input type="radio" name={name} className="sr-only" checked={checked} onChange={onChange} />
      <span className="text-sm font-medium text-foreground">{label}</span>
      <span className="text-[11px] leading-4 text-subtle">{detail}</span>
    </label>
  );
}

function ProBadge() {
  return (
    <Badge variant="accent" className="text-[10px]">
      Pro
    </Badge>
  );
}
