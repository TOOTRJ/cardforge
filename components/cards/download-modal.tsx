"use client";

// ---------------------------------------------------------------------------
// DownloadModal
//
// One dialog covering every "get the card off the screen" path:
//
//   Image        — render of the card (free: 750 px with the PipGlyph mark;
//                  paid: clean 1500 × 2100) as a PNG or a JPEG (TODO 6.18),
//                  with a Rounded / Square switch for EVERY viewer (TODO
//                  3.26, owner decision 2026-09-27): Rounded (the default)
//                  cuts the card's corner transparent, like the card in the
//                  gallery; Square is the full rectangle with the corner in
//                  the border's colour, for printing. Both ask the png route
//                  by name (corners=…). A JPEG has no transparency, so it is
//                  always Square (format=jpeg; the switch shows it).
//                  PAID viewers also pick the print options (TODO 6.1a/6.1b,
//                  lib/cards/print-export.ts): Resolution 600 ppi (1500 ×
//                  2100) or 800 ppi (2000 × 2800), and a 1/8″ bleed
//                  checkbox. Either one is a PRINT render: square, PNG only
//                  (the JPEG chip and Rounded are disabled while one is on,
//                  and the print options while JPEG is), ?ppi=…&bleed=1.
//                  800 ppi says when the frame is upscaled
//                  (printFrameUpscaledAt800 — every template, today).
//   Single PDF   — 2.5"×3.5" page sized exactly to the card; sleeve-ready,
//                  optionally with the 1/8″ bleed and trim crop marks. (Plus+)
//   3×3 Letter   — 9 copies on US Letter with corner crop marks. (Pro)
//   3×3 A4       — 9 copies on A4 with corner crop marks. (Pro)
//
// A free viewer gets exactly ONE live option — the low-resolution
// watermarked image (PNG or JPEG) — and sees the other formats greyed out
// (owner decision 2026-09-15); the upgrade CTA sits on the Image panel. Paid
// tabs are gated by the viewer's plan (enforced server-side too). Available
// formats are plain anchors with `download` so the browser saves the file
// without a client-side fetch.
// ---------------------------------------------------------------------------

import { useState, type ReactNode } from "react";
import {
  Crown,
  Download,
  FileImage,
  FileText,
  Grid3X3,
  Sparkles,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ChipGroup, type ChipOption } from "@/components/ui/chip-group";
import { PremiumBadge } from "@/components/billing/premium-badge";
import { useUpgradeModal } from "@/components/billing/upgrade-modal-provider";
import { cardPngHref, type CardCorners } from "@/lib/cards/output-corners";
import {
  cardImageFilename,
  cardJpegHref,
  effectiveCorners,
  type CardImageFormat,
} from "@/lib/cards/output-format";
import {
  cardPrintFilename,
  cardPrintPngHref,
  DEFAULT_PRINT_PPI,
  isPrintRequest,
  printFrameUpscaledAt800,
  printPixelSize,
  PRINT_800_PPI_PAID_ONLY,
  type PrintPpi,
} from "@/lib/cards/print-export";
import { cn } from "@/lib/utils";

const FORMAT_OPTIONS: ChipOption<CardImageFormat>[] = [
  { value: "png", label: "PNG" },
  { value: "jpeg", label: "JPEG" },
];

const FORMAT_LABEL: Record<CardImageFormat, string> = { png: "PNG", jpeg: "JPEG" };

/** A JPEG — or a print render (800 ppi, bleed) — can't be rounded: Rounded
 *  is shown but not selectable. */
function cornerOptions(format: CardImageFormat, print: boolean): ChipOption<CardCorners>[] {
  return [
    { value: "round", label: "Rounded", disabled: format === "jpeg" || print },
    { value: "square", label: "Square" },
  ];
}

/** One line under the switch — tier-aware: only a paid viewer has the PDF. */
function cornersHint(isPaid: boolean, format: CardImageFormat, print: boolean): string {
  if (print) return "Print files are always Square — they're cut along the rectangle.";
  if (format === "jpeg") return "JPEG has no transparency, so it's always Square — a smaller file.";
  return isPaid
    ? "Rounded for sharing; choose Square (or the PDF) to print."
    : "Rounded for sharing; choose Square to print.";
}

type DownloadModalProps = {
  cardId: string;
  cardSlug: string;
  /** Optional custom trigger. When omitted the modal renders its own
   *  "Download" button styled as an outline button. */
  trigger?: ReactNode;
  /** Tab to open first. Defaults to "single" since one card on one page
   *  is the most common pick (free users always start on Image). */
  defaultTab?: DownloadTab;
  /** Viewer entitlement. PDF needs a paid plan; sheets need Pro. Defaults to
   *  the free experience. */
  isPaid?: boolean;
  canBatch?: boolean;
  /** This viewer's download will not be the stored (gallery) image — a
   *  paid clean download whose stored look is older, or a free download of
   *  a card still owed a platform correction (both render live). Computed
   *  on the server with downloadDiffersFromGallery (lib/cards/layout-version.ts). */
  downloadDiffersFromGallery?: boolean;
  /** The card's frame template — the 800 ppi option says when its frame is
   *  upscaled (lib/cards/print-export.ts printFrameUpscaledAt800). */
  frameTemplate?: string;
};

type DownloadTab = "png" | "single" | "letter" | "a4";

export function DownloadModal({
  cardId,
  cardSlug,
  trigger,
  defaultTab = "single",
  isPaid = false,
  canBatch = false,
  downloadDiffersFromGallery = false,
  frameTemplate,
}: DownloadModalProps) {
  const upgrade = useUpgradeModal();
  // PNG first; its corner Rounded first, like the card in the gallery. A
  // JPEG is always square — the PNG's choice is kept for switching back.
  const [format, setFormat] = useState<CardImageFormat>("png");
  const [pngCorners, setPngCorners] = useState<CardCorners>("round");
  // Print options (paid; TODO 6.1a/6.1b): a print render is square + PNG.
  const [ppi, setPpi] = useState<PrintPpi>(DEFAULT_PRINT_PPI);
  const [bleed, setBleed] = useState(false);
  const [pdfBleed, setPdfBleed] = useState(false);
  // 800 ppi follows PRINT_800_PPI_PAID_ONLY (the open 6.1b [decide]); the
  // bleed is always a clean-download feature.
  const can800 = isPaid || !PRINT_800_PPI_PAID_ONLY;
  const printOptions = { ppi: can800 ? ppi : DEFAULT_PRINT_PPI, bleed: isPaid && bleed };
  const print = format === "png" && isPrintRequest(printOptions);
  const corners = print ? "square" : effectiveCorners(format, pngCorners);
  const preset = isPaid ? "hd" : "default";
  const base = `/api/cards/${cardId}`;
  // Free users start on the Image tab — the one format they can actually use.
  const initialTab: DownloadTab = isPaid ? defaultTab : "png";
  const links: Record<DownloadTab, { href: string; filename: string }> = {
    // The server clamps a free viewer to 750 px anyway; asking for it
    // outright keeps the URL honest about what they get. A PNG always names
    // its corner: the route's default is square (older callers).
    png: print
      ? { href: cardPrintPngHref(cardId, printOptions), filename: cardPrintFilename(cardSlug, printOptions) }
      : {
          href:
            format === "jpeg"
              ? cardJpegHref(cardId, { preset })
              : cardPngHref(cardId, { preset, corners }),
          filename: cardImageFilename(cardSlug, { format, corners }),
        },
    single: pdfBleed
      ? { href: `${base}/pdf?layout=card&bleed=1`, filename: `${cardSlug}-bleed.pdf` }
      : { href: `${base}/pdf?layout=card`, filename: `${cardSlug}.pdf` },
    letter: {
      href: `${base}/pdf?layout=sheet&paper=letter`,
      filename: `${cardSlug}-sheet.pdf`,
    },
    a4: {
      href: `${base}/pdf?layout=sheet&paper=a4`,
      filename: `${cardSlug}-sheet-a4.pdf`,
    },
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline">
            <Download className="h-4 w-4" aria-hidden /> Download
          </Button>
        )}
      </DialogTrigger>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Download this card</DialogTitle>
          <DialogDescription>
            Pick a format. Sheets include corner crop marks; cut along them
            for sleeve-ready cards.
          </DialogDescription>
        </DialogHeader>
        <div className="px-5 py-5">
          <Tabs defaultValue={initialTab}>
            <TabsList ariaLabel="Download format">
              <TabsTrigger value="png">
                <FileImage className="h-3.5 w-3.5" aria-hidden />
                Image
              </TabsTrigger>
              <TabsTrigger
                value="single"
                disabled={!isPaid}
                title={isPaid ? undefined : "PDF export is a Plus feature"}
              >
                <FileText className="h-3.5 w-3.5" aria-hidden />
                PDF
              </TabsTrigger>
              <TabsTrigger
                value="letter"
                disabled={!canBatch}
                title={canBatch ? undefined : "Sheet layouts are a Pro feature"}
              >
                <Grid3X3 className="h-3.5 w-3.5" aria-hidden />
                3×3 Letter
              </TabsTrigger>
              <TabsTrigger
                value="a4"
                disabled={!canBatch}
                title={canBatch ? undefined : "Sheet layouts are a Pro feature"}
              >
                <Grid3X3 className="h-3.5 w-3.5" aria-hidden />
                3×3 A4
              </TabsTrigger>
            </TabsList>
            {downloadDiffersFromGallery ? (
              <p
                className="mt-2 text-[11px] leading-4 text-subtle"
                data-testid="download-layout-note"
              >
                Downloads are drawn with the current card layout, so they can
                look slightly different from this card&apos;s gallery image.
              </p>
            ) : null}
            {!isPaid ? (
              <p className="mt-2 text-[11px] leading-4 text-subtle">
                PDF is a Plus feature; 3×3 sheets are Pro.
              </p>
            ) : !canBatch ? (
              <p className="mt-2 text-[11px] leading-4 text-subtle">
                3×3 sheets are a Pro feature.
              </p>
            ) : null}

            <TabsContent value="png" className="mt-5">
              <FormatSwitch value={format} onChange={setFormat} jpegDisabled={print} />
              <CornersSwitch
                value={corners}
                onChange={setPngCorners}
                isPaid={isPaid}
                format={format}
                print={print}
              />
              {can800 ? (
                <PrintOptions
                  ppi={ppi}
                  onPpiChange={setPpi}
                  bleed={bleed}
                  onBleedChange={isPaid ? setBleed : null}
                  disabled={format === "jpeg"}
                  frameUpscaled={printFrameUpscaledAt800(frameTemplate)}
                />
              ) : null}
              {isPaid ? (
                <DownloadPanel
                  title={print ? printTitle(printOptions) : `High-resolution ${FORMAT_LABEL[format]}`}
                  description={
                    print
                      ? printDescription(printOptions, printFrameUpscaledAt800(frameTemplate))
                      : format === "jpeg"
                        ? "Clean, full-resolution (1500 × 2100) render with square corners, in a smaller file than the PNG."
                        : "Clean, full-resolution (1500 × 2100) render. Rounded for sharing and embedding; Square for printing single cards."
                  }
                  href={links.png.href}
                  filename={links.png.filename}
                />
              ) : (
                // The moment of value: the card is done and wanted. Free path
                // stays a first-class button (never buried); the clean
                // version rides beside it. No countdowns, no guilt copy.
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1">
                    <h3 className="font-display text-sm font-semibold text-foreground">
                      {print ? printTitle(printOptions) : `Low-resolution ${FORMAT_LABEL[format]}`}
                    </h3>
                    <p className="text-xs leading-5 text-muted">
                      {print
                        ? // Only when PRINT_800_PPI_PAID_ONLY is off: a free
                          // viewer's 800 ppi file keeps the mark (the bleed
                          // stays paid, so this is never a bleed file).
                          `${freePrintSize(printOptions.ppi)} with the PipGlyph mark, square — for printing and playtesting. Plus and Pro download it clean, with an optional 1/8″ bleed.`
                        : "750 × 1050 with the PipGlyph mark — fine for sharing and playtesting. Plus and Pro download a clean, print-ready 1500 × 2100 image."}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button asChild variant="outline">
                      <a href={links.png.href} download={links.png.filename}>
                        <Download className="h-4 w-4" aria-hidden /> Download
                        free {FORMAT_LABEL[format]}
                      </a>
                    </Button>
                    <Button
                      type="button"
                      onClick={() => upgrade.open("hi_res_export")}
                    >
                      <Sparkles className="h-4 w-4" aria-hidden /> Remove the
                      mark — try Plus free
                    </Button>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="single" className="mt-5">
              {isPaid ? (
                <BleedCheckbox
                  checked={pdfBleed}
                  onChange={setPdfBleed}
                  testId="download-pdf-bleed"
                  hint="The page grows to 2.75″ × 3.75″ plus a margin, with crop marks on the trim line."
                />
              ) : null}
              <DownloadPanel
                title="Single card PDF"
                description="One page sized exactly to a standard MTG card (2.5″ × 3.5″ / 63.5 × 88.9 mm). Drop it into a 9-pocket page or print onto card stock and cut."
                href={links.single.href}
                filename={links.single.filename}
                locked={!isPaid}
                onUpgrade={() => upgrade.open("pdf_export")}
              />
            </TabsContent>

            <TabsContent value="letter" className="mt-5">
              <DownloadPanel
                title="3 × 3 sheet — US Letter"
                description="Nine copies tiled on a US Letter (8.5″ × 11″) page with corner crop marks. Recommended paper: 110 lb. card stock."
                href={links.letter.href}
                filename={links.letter.filename}
                locked={!canBatch}
                onUpgrade={() => upgrade.open("batch_export")}
              />
            </TabsContent>

            <TabsContent value="a4" className="mt-5">
              <DownloadPanel
                title="3 × 3 sheet — A4"
                description="Nine copies tiled on an A4 (210 × 297 mm) page with corner crop marks. Recommended paper: 250 g/m² card stock."
                href={links.a4.href}
                filename={links.a4.filename}
                locked={!canBatch}
                onUpgrade={() => upgrade.open("batch_export")}
              />
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** PNG or JPEG (TODO 6.18) — every viewer, free included. A print render
 *  (800 ppi, bleed) is PNG only: JPEG is shown but not selectable then. */
function FormatSwitch({
  value,
  onChange,
  jpegDisabled = false,
}: {
  value: CardImageFormat;
  onChange: (next: CardImageFormat) => void;
  jpegDisabled?: boolean;
}) {
  return (
    <div className="mb-4 flex flex-col gap-1.5" data-testid="download-format">
      <span className="text-xs font-medium text-foreground">File type</span>
      <ChipGroup
        ariaLabel="File type"
        options={FORMAT_OPTIONS.map((option) =>
          option.value === "jpeg" && jpegDisabled ? { ...option, disabled: true } : option,
        )}
        value={value}
        onChange={onChange}
      />
    </div>
  );
}

const PPI_OPTIONS: ChipOption<"600" | "800">[] = [
  { value: "600", label: "600 ppi · 1500 × 2100" },
  { value: "800", label: "800 ppi · 2000 × 2800" },
];

/** "800 ppi PNG with bleed", "PNG with bleed", "800 ppi PNG". */
function printTitle(opts: { ppi: PrintPpi; bleed: boolean }): string {
  const res = opts.ppi === DEFAULT_PRINT_PPI ? "" : `${opts.ppi} ppi `;
  return `${res}PNG${opts.bleed ? " with 1/8″ bleed" : ""} for print`;
}

/** "2000 × 2800 (800 ppi)" — a free viewer's print file (no bleed). */
function freePrintSize(ppi: PrintPpi): string {
  const { width, height } = printPixelSize(ppi, { bleed: false });
  return `${width} × ${height} (${ppi} ppi)`;
}

function printDescription(opts: { ppi: PrintPpi; bleed: boolean }, frameUpscaled: boolean): string {
  const trim = opts.ppi === 800 ? "2000 × 2800" : "1500 × 2100";
  const size = opts.bleed ? (opts.ppi === 800 ? "2200 × 3000" : "1650 × 2250") : trim;
  const parts = [
    `Clean ${size} render with square corners, the art at full resolution.`,
    opts.bleed
      ? `The card (${trim} at the trim) runs 1/8″ past the trim line on every side (2.75″ × 3.75″) — cut along the card's edge.`
      : null,
    opts.ppi === 800
      ? frameUpscaled
        ? "Text and symbols are drawn at 800 ppi; this frame is upscaled from its 600 ppi master."
        : "Text, symbols and the frame are drawn at 800 ppi."
      : null,
  ];
  return parts.filter(Boolean).join(" ");
}

/** Resolution + bleed (paid; TODO 6.1a/6.1b) — PNG only. */
function PrintOptions({
  ppi,
  onPpiChange,
  bleed,
  onBleedChange,
  disabled,
  frameUpscaled,
}: {
  ppi: PrintPpi;
  onPpiChange: (next: PrintPpi) => void;
  bleed: boolean;
  /** Null: no bleed for this viewer (it follows the clean download). */
  onBleedChange: ((next: boolean) => void) | null;
  disabled: boolean;
  frameUpscaled: boolean;
}) {
  return (
    <div className="mb-4 flex flex-col gap-3" data-testid="download-print">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-foreground">Resolution</span>
        <ChipGroup
          ariaLabel="Resolution"
          options={PPI_OPTIONS.map((option) => ({ ...option, disabled }))}
          value={disabled ? "600" : String(ppi) as "600" | "800"}
          onChange={(next) => onPpiChange(Number(next) as PrintPpi)}
        />
        <p className="text-[11px] leading-4 text-subtle">
          {disabled
            ? "800 ppi and bleed are PNG only."
            : frameUpscaled
              ? "800 ppi draws the text and art sharper; the frame itself is upscaled."
              : "800 ppi for print shops that ask for it."}
        </p>
      </div>
      {onBleedChange ? (
        <BleedCheckbox
          checked={bleed && !disabled}
          onChange={onBleedChange}
          disabled={disabled}
          testId="download-bleed"
          hint="Extends the card 1/8″ past the trim on every side (2.75″ × 3.75″) for print shops."
        />
      ) : null}
    </div>
  );
}

function BleedCheckbox({
  checked,
  onChange,
  disabled = false,
  testId,
  hint,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  testId: string;
  hint: string;
}) {
  return (
    <label
      className={cn(
        "mb-4 flex cursor-pointer items-start gap-3 rounded-lg border border-border/60 bg-elevated/30 px-4 py-3 text-sm text-foreground has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 accent-[var(--color-primary)]"
        data-testid={testId}
      />
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">Add a 1/8″ bleed</span>
        <span className="text-xs leading-5 text-muted">{hint}</span>
      </span>
    </label>
  );
}

/** The image's Rounded / Square switch — every viewer, free included. A
 *  JPEG shows Square with Rounded disabled. */
function CornersSwitch({
  value,
  onChange,
  isPaid,
  format,
  print = false,
}: {
  value: CardCorners;
  onChange: (next: CardCorners) => void;
  isPaid: boolean;
  format: CardImageFormat;
  print?: boolean;
}) {
  return (
    <div className="mb-4 flex flex-col gap-1.5" data-testid="download-corners">
      <span className="text-xs font-medium text-foreground">Corners</span>
      <ChipGroup
        ariaLabel="Corners"
        options={cornerOptions(format, print)}
        value={value}
        onChange={onChange}
      />
      <p className="text-[11px] leading-4 text-subtle">{cornersHint(isPaid, format, print)}</p>
    </div>
  );
}

function DownloadPanel({
  title,
  description,
  href,
  filename,
  locked = false,
  onUpgrade,
}: {
  title: string;
  description: string;
  href: string;
  filename: string;
  locked?: boolean;
  onUpgrade?: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="flex items-center gap-2 font-display text-sm font-semibold text-foreground">
          {title}
          {locked ? <PremiumBadge /> : null}
        </h3>
        <p className="text-xs leading-5 text-muted">{description}</p>
      </div>
      {locked ? (
        <Button
          type="button"
          className={cn("self-start")}
          onClick={onUpgrade}
        >
          <Crown className="h-4 w-4" aria-hidden /> Upgrade to unlock
        </Button>
      ) : (
        <Button asChild className={cn("self-start")}>
          <a href={href} download={filename}>
            <Download className="h-4 w-4" aria-hidden /> Download
          </a>
        </Button>
      )}
    </div>
  );
}
