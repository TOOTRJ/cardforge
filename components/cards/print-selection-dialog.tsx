"use client";

import { useMemo, useState } from "react";
import { Loader2, Minus, Package, Plus, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChipGroup, type ChipOption } from "@/components/ui/chip-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useDeckExport } from "@/components/decks/deck-export-provider";
import { APPROX_BYTES_PER_CARD, formatBytes } from "@/lib/decks/export-client";
import {
  budgetCopies,
  loadPrintSelectionSettings,
  MAX_COPIES_PER_CARD,
  MAX_SELECTION_CARDS,
  MAX_SELECTION_COPIES,
  savePrintSelectionSettings,
  type PrintSelectionSettings,
  type SelectionExportKind,
  type SelectionImageSize,
  type SelectionPdfLayout,
} from "@/lib/cards/print-selection";
import { planSheet } from "@/lib/render/sheet-layout";
import {
  perSheetLabel,
  PrintBacksCheckbox,
  PrintBleedCheckbox,
  PrintField as Field,
  SheetOptionsFields,
} from "@/components/cards/print-sheet-options";

// ---------------------------------------------------------------------------
// PrintSelectionDialog — "Print / download selected" (TODO 6.15): the cards
// picked in My Cards (your own, or the ones you liked) as a print PDF or a
// ZIP of clean images. Card Conjurer's /print tool is the model:
//
//   Print PDF — sheets (Letter / A4) or one card per page. Sheets take a
//               gap (none or 1/16″), cut guides (corner marks or
//               full-length lines), the card size (2.5 × 3.5 in or
//               63 × 88 mm) and per-card copies; both take the 1/8″ bleed
//               (TODO 6.1a — each card becomes its print render with the
//               bleed, and the grid makes room for it).
//   ZIP       — one clean image per card (HD or standard; HD may carry the
//               bleed), square like every print file — or MakePlayingCards'
//               poker-size file (TODO 6.1: MPC's own bleed, 1644 × 2244,
//               a Battle or Split turned portrait; never the 1/8″ on top).
//
// Pro, like the deck export (the caller opens the upgrade modal instead of
// this dialog for anyone else; POST /api/cards/export checks it again). The
// build runs in the background through DeckExportProvider. The settings are
// remembered in this browser (lib/cards/print-selection.ts); copies are not.
// ---------------------------------------------------------------------------

export type PrintSelectionCard = {
  id: string;
  slug: string;
  title: string;
  /** A double-faced card with a back of its own (TODO 5.3): the "Include
   *  back faces" option shows when the selection has one. */
  hasBack?: boolean;
};

type PrintSelectionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The selection, in display order. */
  cards: PrintSelectionCard[];
  /** Called once the export has started (the dialog has closed). */
  onStarted?: () => void;
};

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

export function PrintSelectionDialog({ open, onOpenChange, cards, onStarted }: PrintSelectionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="max-w-2xl">
        {/* Mounted only while open, so every open starts from the settings
            this browser used last. */}
        {open ? (
          <PrintSelectionBody
            cards={cards}
            onClose={() => onOpenChange(false)}
            onStarted={onStarted}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function PrintSelectionBody({
  cards,
  onClose,
  onStarted,
}: {
  cards: PrintSelectionCard[];
  onClose: () => void;
  onStarted?: () => void;
}) {
  const exporter = useDeckExport();
  const [settings, setSettings] = useState<PrintSelectionSettings>(() => loadPrintSelectionSettings());
  const [copies, setCopies] = useState<Record<string, number>>({});
  const patch = (next: Partial<PrintSelectionSettings>) => setSettings((prev) => ({ ...prev, ...next }));

  const included = useMemo(() => cards.slice(0, MAX_SELECTION_CARDS), [cards]);
  const isPdf = settings.kind === "pdf";
  const isSheets = isPdf && settings.layout !== "pages";
  // A bleed ZIP is the 600 ppi print render — HD only (an MPC image carries
  // MPC's own bleed).
  const bleed = settings.bleed && (isPdf || settings.quality === "hd");
  const mpc = !isPdf && settings.quality === "mpc";

  // What the export will actually ask for — the server budgets the same way.
  const budgeted = useMemo(
    () => budgetCopies(included.map((card) => ({ id: card.id, copies: isSheets ? (copies[card.id] ?? 1) : 1 }))),
    [included, copies, isSheets],
  );
  const physical = budgeted.reduce((n, card) => n + card.copies, 0);
  const asked = included.reduce((n, card) => n + (copies[card.id] ?? 1), 0);

  const plan = isSheets
    ? planSheet(settings.layout === "sheet-a4" ? "a4" : "letter", {
        gap: settings.gap,
        marks: settings.marks,
        cardSize: settings.cardSize,
        bleed,
      })
    : null;
  const sheets = plan ? Math.ceil(physical / plan.perPage) : 0;

  const doubleFaced = included.filter((card) => card.hasBack).length;

  const start = () => {
    savePrintSelectionSettings(settings);
    exporter.start({
      cards: budgeted,
      kind: settings.kind,
      quality: settings.quality,
      layout: settings.layout,
      sheet: { gap: settings.gap, marks: settings.marks, cardSize: settings.cardSize },
      bleed,
      // A double-faced card's back too (TODO 5.3), unless switched off.
      includeBacks: settings.includeBacks,
      titles: Object.fromEntries(included.map((card) => [card.id, card.title])),
    });
    onClose();
    onStarted?.();
  };

  const count = cards.length;
  const zipEstimate = formatBytes(included.length * APPROX_BYTES_PER_CARD[bleed ? "hd" : settings.quality] * (bleed ? 1.15 : 1));

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          Print or download {count} card{count === 1 ? "" : "s"}
        </DialogTitle>
        <DialogDescription>
          Every card renders clean at full resolution in the background — start it, keep browsing, and watch the
          progress card at the bottom right.
        </DialogDescription>
      </DialogHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-5" data-testid="print-selection">
        {exporter.busy ? (
          <p className="flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-foreground">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" aria-hidden />
            An export is already running. It has to finish before another starts.
          </p>
        ) : null}
        {count > MAX_SELECTION_CARDS ? (
          <p className="text-xs leading-5 text-subtle">
            One export takes up to {MAX_SELECTION_CARDS} cards — the first {MAX_SELECTION_CARDS} are included.
          </p>
        ) : null}

        <Field label="Output">
          <ChipGroup ariaLabel="Output" options={KIND_OPTIONS} value={settings.kind} onChange={(kind) => patch({ kind })} />
        </Field>

        {isPdf ? (
          <>
            <Field label="Layout">
              <ChipGroup
                ariaLabel="Layout"
                options={LAYOUT_OPTIONS}
                value={settings.layout}
                onChange={(layout) => patch({ layout })}
              />
            </Field>
            {isSheets ? <SheetOptionsFields value={settings} onChange={patch} /> : null}
          </>
        ) : (
          <Field label="Image size">
            <ChipGroup
              ariaLabel="Image size"
              options={QUALITY_OPTIONS}
              value={settings.quality}
              onChange={(quality) => patch({ quality })}
            />
            {mpc ? (
              <p className="text-xs leading-5 text-subtle" data-testid="print-selection-mpc">
                MakePlayingCards&apos; poker-size upload: 822 × 1122 at 300 dpi, here at 600 — the card plus
                MPC&apos;s bleed, square corners. A Battle or Split is turned onto MPC&apos;s portrait card, its title up the left edge.
              </p>
            ) : null}
          </Field>
        )}

        <PrintBleedCheckbox
          checked={bleed}
          disabled={!isPdf && settings.quality !== "hd"}
          onChange={(next) => patch({ bleed: next })}
          testId="print-selection-bleed"
          hint={
            !isPdf
              ? settings.quality === "hd"
                ? "1650 × 2250 print files: the card runs 1/8″ past its trim on every side."
                : mpc
                  ? "MakePlayingCards files carry MPC's own bleed."
                  : "The bleed comes with the HD images only."
              : isSheets
                ? "Each card runs 1/8″ past its trim; the guides mark the trim. Fewer cards fit on a sheet."
                : "Each page is the card with its bleed, crop marks on the trim."
          }
        />

        {doubleFaced > 0 ? (
          <PrintBacksCheckbox
            checked={settings.includeBacks}
            onChange={(next) => patch({ includeBacks: next })}
            testId="print-selection-backs"
            hint={
              isPdf
                ? isSheets
                  ? `${doubleFaced} double-faced card${doubleFaced === 1 ? "" : "s"}: the back printed beside its front, every copy.`
                  : `${doubleFaced} double-faced card${doubleFaced === 1 ? "" : "s"}: the back on its own page after the front.`
                : `${doubleFaced} double-faced card${doubleFaced === 1 ? "" : "s"}: the back as its own image, <name>-back.png.`
            }
          />
        ) : null}

        {isSheets ? (
          <Field label="Copies">
            <ul className="flex max-h-56 flex-col gap-1.5 overflow-y-auto pr-1" data-testid="print-selection-copies">
              {included.map((card) => (
                <li key={card.id} className="flex items-center gap-3 rounded-md border border-border/60 px-3 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">{card.title}</span>
                  <CopiesStepper
                    title={card.title}
                    value={copies[card.id] ?? 1}
                    onChange={(next) => setCopies((prev) => ({ ...prev, [card.id]: next }))}
                  />
                </li>
              ))}
            </ul>
            {asked > physical ? (
              <p className="text-xs leading-5 text-subtle">
                One export prints up to {MAX_SELECTION_COPIES} cards — later copies are left out.
              </p>
            ) : null}
          </Field>
        ) : null}

        <p className="text-xs leading-5 text-muted" data-testid="print-selection-summary">
          {plan
            ? `${perSheetLabel(plan)} · ${physical} card${physical === 1 ? "" : "s"} on ${sheets} sheet${sheets === 1 ? "" : "s"}. Guides print in the margins and gaps, never on a card.`
            : isPdf
              ? `${included.length} page${included.length === 1 ? "" : "s"}, one card each${bleed ? " with its bleed" : ""}.`
              : `${included.length} image${included.length === 1 ? "" : "s"} · ≈ ${zipEstimate}.`}
        </p>
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" onClick={start} disabled={exporter.busy || included.length === 0}>
          {isPdf ? <Printer className="h-4 w-4" aria-hidden /> : <Package className="h-4 w-4" aria-hidden />}
          {isPdf ? "Build PDF" : "Build ZIP"}
        </Button>
      </DialogFooter>
    </>
  );
}

function CopiesStepper({
  title,
  value,
  onChange,
}: {
  title: string;
  value: number;
  onChange: (next: number) => void;
}) {
  const set = (next: number) => onChange(Math.min(MAX_COPIES_PER_CARD, Math.max(1, Math.round(next) || 1)));
  // What is being typed. A controlled number field snapped straight back to
  // 1 when cleared, so "1" → backspace → "5" read as 15; the field keeps the
  // draft (empty included), the count follows every valid number, and
  // leaving the field shows the count again.
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <span className="flex shrink-0 items-center gap-1">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 w-7 p-0"
        onClick={() => set(value - 1)}
        disabled={value <= 1}
        aria-label={`One fewer copy of ${title}`}
      >
        <Minus className="h-3.5 w-3.5" aria-hidden />
      </Button>
      <input
        type="number"
        inputMode="numeric"
        min={1}
        max={MAX_COPIES_PER_CARD}
        value={draft ?? value}
        onChange={(event) => {
          const raw = event.target.value;
          setDraft(raw);
          if (raw.trim() !== "" && Number.isFinite(Number(raw))) set(Number(raw));
        }}
        onBlur={() => setDraft(null)}
        aria-label={`Copies of ${title}`}
        className="h-7 w-12 rounded-md border border-border bg-background/60 text-center text-sm tabular-nums text-foreground"
      />
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 w-7 p-0"
        onClick={() => set(value + 1)}
        disabled={value >= MAX_COPIES_PER_CARD}
        aria-label={`One more copy of ${title}`}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
      </Button>
    </span>
  );
}
