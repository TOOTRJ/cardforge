"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, Package, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChipGroup, type ChipOption } from "@/components/ui/chip-group";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useDeckExport } from "@/components/decks/deck-export-provider";
import { perSheetLabel, PrintBleedCheckbox, PrintField as Field, SheetOptionsFields } from "@/components/cards/print-sheet-options";
import { trackToolEventAction } from "@/lib/tools/actions";
import { APPROX_BYTES_PER_CARD, formatBytes } from "@/lib/decks/export-client";
import {
  loadPrintSelectionSettings,
  MAX_SELECTION_COPIES,
  savePrintSelectionSettings,
  type PrintSelectionSettings,
  type SelectionExportKind,
  type SelectionImageSize,
  type SelectionPdfLayout,
} from "@/lib/cards/print-selection";
import { planSheet } from "@/lib/render/sheet-layout";
import type { KitItem } from "@/lib/tools/token-kit/collect";
import type { KitFrame, KitItemState, KitSettings } from "@/lib/tools/token-kit/model";
import { kitPrintTokens, kitSlug } from "@/lib/tools/token-kit/workspace";

// ---------------------------------------------------------------------------
// Print or download the kit — the selection dialog's options (the shared
// sheet fields, the same remembered settings, lib/cards/print-selection.ts)
// over the kit's tokens, built in the background by DeckExportProvider
// (runKitExport: each token rendered by the kit's render route, the same
// PDF builder and ZIP). Copies are the kit's own, chosen on the tiles.
//
// A print file (the PDF, HD images, the bleed, MakePlayingCards) is a CLEAN
// download, as on every card (the png route's rule): a free account gets
// the standard images, watermarked, and the way to a plan.
// ---------------------------------------------------------------------------

const KIND_OPTIONS: ChipOption<SelectionExportKind>[] = [
  { value: "pdf", label: "Print PDF", icon: Printer },
  { value: "zip", label: "Images · ZIP", icon: Package },
];

const LAYOUT_OPTIONS: ChipOption<SelectionPdfLayout>[] = [
  { value: "sheet-letter", label: "Sheets · Letter" },
  { value: "sheet-a4", label: "Sheets · A4" },
  { value: "pages", label: "One per page" },
];

const QUALITY_OPTIONS: ChipOption<SelectionImageSize>[] = [
  { value: "hd", label: "HD · 1500 × 2100" },
  { value: "default", label: "Standard · 750 × 1050" },
  { value: "mpc", label: "MakePlayingCards · 1644 × 2244" },
];

export function KitPrintDialog({
  open,
  onOpenChange,
  ...body
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
} & KitPrintBodyProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="max-w-2xl">
        {open ? <KitPrintBody {...body} onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

type KitPrintBodyProps = {
  title: string;
  items: KitItem[];
  states: Record<string, KitItemState>;
  frames: Record<string, KitFrame>;
  settings: KitSettings;
  cleanDownloads: boolean;
};

function KitPrintBody({ title, items, states, frames, settings: kitSettings, cleanDownloads, onClose }: KitPrintBodyProps & { onClose: () => void }) {
  const exporter = useDeckExport();
  const [settings, setSettings] = useState<PrintSelectionSettings>(() => {
    const stored = loadPrintSelectionSettings();
    // A free account's one file: the standard images.
    return cleanDownloads ? stored : { ...stored, kind: "zip", quality: "default", bleed: false };
  });
  const patch = (next: Partial<PrintSelectionSettings>) => setSettings((prev) => ({ ...prev, ...next }));

  const isPdf = settings.kind === "pdf";
  const isSheets = isPdf && settings.layout !== "pages";
  const bleed = settings.bleed && (isPdf || settings.quality === "hd");
  const mpc = !isPdf && settings.quality === "mpc";

  const tokens = useMemo(() => kitPrintTokens(items, states, frames, { sheets: isSheets }), [items, states, frames, isSheets]);
  const physical = tokens.reduce((n, token) => n + token.copies, 0);
  const asked = isSheets
    ? items.reduce((n, item) => n + (states[item.key]?.include && frames[item.key]?.ok ? states[item.key].copies : 0), 0)
    : tokens.length;
  const plan = isSheets
    ? planSheet(settings.layout === "sheet-a4" ? "a4" : "letter", {
        gap: settings.gap,
        marks: settings.marks,
        cardSize: settings.cardSize,
        bleed,
      })
    : null;
  const sheets = plan ? Math.ceil(physical / plan.perPage) : 0;
  const zipEstimate = formatBytes(tokens.length * APPROX_BYTES_PER_CARD[bleed ? "hd" : settings.quality] * (bleed ? 1.15 : 1));

  const start = () => {
    if (cleanDownloads) savePrintSelectionSettings(settings);
    const byKey = new Map(items.map((item) => [item.key, item]));
    exporter.start({
      kit: {
        title: `${title} tokens`,
        slug: `${kitSlug(title, "kit")}-tokens`,
        tokens: tokens.map((token) => {
          const state = states[token.key];
          return {
            ...token,
            body: {
              face: byKey.get(token.key)!.face,
              settings: kitSettings,
              state: { artUrl: state.artUrl, artistCredit: state.artistCredit, artPosition: state.artPosition },
            },
          };
        }),
      },
      kind: settings.kind,
      quality: settings.quality,
      layout: settings.layout,
      sheet: { gap: settings.gap, marks: settings.marks, cardSize: settings.cardSize },
      bleed,
    });
    void trackToolEventAction("token-kit", "kit_exported", {
      kind: settings.kind,
      layout: isPdf ? settings.layout : settings.quality,
      bleed,
      tokens: tokens.length,
      cards: physical,
      design: kitSettings.design,
    }).catch(() => undefined);
    onClose();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Print or download the kit</DialogTitle>
        <DialogDescription>
          {tokens.length} token{tokens.length === 1 ? "" : "s"} render in the background at full resolution — start it,
          keep working, and watch the progress card at the bottom right.
        </DialogDescription>
      </DialogHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-5" data-testid="kit-print">
        {exporter.busy ? (
          <p className="flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-foreground">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" aria-hidden />
            An export is already running. It has to finish before another starts.
          </p>
        ) : null}

        {!cleanDownloads ? (
          <p className="rounded-lg border border-gold/40 bg-gold/10 px-4 py-3 text-sm leading-6 text-foreground">
            Print files — the PDF, HD images, the bleed and MakePlayingCards — are clean downloads, part of every paid
            plan. On your plan the kit downloads as standard images with the pipglyph.com mark.{" "}
            <Link href="/pricing" className="font-medium text-primary-bright underline underline-offset-2">
              See plans
            </Link>
          </p>
        ) : null}

        <Field label="Output">
          <ChipGroup
            ariaLabel="Output"
            options={KIND_OPTIONS.map((option) => (option.value === "pdf" && !cleanDownloads ? { ...option, disabled: true } : option))}
            value={settings.kind}
            onChange={(kind) => patch({ kind })}
          />
        </Field>

        {isPdf ? (
          <>
            <Field label="Layout">
              <ChipGroup ariaLabel="Layout" options={LAYOUT_OPTIONS} value={settings.layout} onChange={(layout) => patch({ layout })} />
            </Field>
            {isSheets ? <SheetOptionsFields value={settings} onChange={patch} /> : null}
          </>
        ) : (
          <Field label="Image size">
            <ChipGroup
              ariaLabel="Image size"
              options={QUALITY_OPTIONS.map((option) => (option.value !== "default" && !cleanDownloads ? { ...option, disabled: true } : option))}
              value={settings.quality}
              onChange={(quality) => patch({ quality })}
            />
          </Field>
        )}

        {cleanDownloads ? (
          <PrintBleedCheckbox
            checked={bleed}
            disabled={!isPdf && settings.quality !== "hd"}
            onChange={(next) => patch({ bleed: next })}
            testId="kit-print-bleed"
            hint={
              !isPdf
                ? settings.quality === "hd"
                  ? "1650 × 2250 print files: the token runs 1/8″ past its trim on every side."
                  : mpc
                    ? "MakePlayingCards files carry MPC's own bleed."
                    : "The bleed comes with the HD images only."
                : isSheets
                  ? "Each token runs 1/8″ past its trim; the guides mark the trim. Fewer fit on a sheet."
                  : "Each page is the token with its bleed, crop marks on the trim."
            }
          />
        ) : null}

        <p className="text-xs leading-5 text-muted" data-testid="kit-print-summary">
          {plan
            ? `${perSheetLabel(plan)} · ${physical} card${physical === 1 ? "" : "s"} on ${sheets} sheet${sheets === 1 ? "" : "s"}. Copies are the ones on each token.`
            : isPdf
              ? `${tokens.length} page${tokens.length === 1 ? "" : "s"}, one token each${bleed ? " with its bleed" : ""}.`
              : `${tokens.length} image${tokens.length === 1 ? "" : "s"}, one per token · ≈ ${zipEstimate}.`}
          {asked > physical ? ` One export prints up to ${MAX_SELECTION_COPIES} cards — later copies are left out.` : ""}
        </p>
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" onClick={start} disabled={exporter.busy || tokens.length === 0}>
          {isPdf ? <Printer aria-hidden /> : <Package aria-hidden />}
          {isPdf ? "Build PDF" : "Build ZIP"}
        </Button>
      </DialogFooter>
    </>
  );
}
