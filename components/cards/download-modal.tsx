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
//   Single PDF   — 2.5"×3.5" page sized exactly to the card; sleeve-ready. (Plus+)
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
import { cn } from "@/lib/utils";

const FORMAT_OPTIONS: ChipOption<CardImageFormat>[] = [
  { value: "png", label: "PNG" },
  { value: "jpeg", label: "JPEG" },
];

const FORMAT_LABEL: Record<CardImageFormat, string> = { png: "PNG", jpeg: "JPEG" };

/** A JPEG can't be rounded: Rounded is shown but not selectable. */
function cornerOptions(format: CardImageFormat): ChipOption<CardCorners>[] {
  return [
    { value: "round", label: "Rounded", disabled: format === "jpeg" },
    { value: "square", label: "Square" },
  ];
}

/** One line under the switch — tier-aware: only a paid viewer has the PDF. */
function cornersHint(isPaid: boolean, format: CardImageFormat): string {
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
   *  is the most common pick (free users always start on PNG). */
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
}: DownloadModalProps) {
  const upgrade = useUpgradeModal();
  // PNG first; its corner Rounded first, like the card in the gallery. A
  // JPEG is always square — the PNG's choice is kept for switching back.
  const [format, setFormat] = useState<CardImageFormat>("png");
  const [pngCorners, setPngCorners] = useState<CardCorners>("round");
  const corners = effectiveCorners(format, pngCorners);
  const preset = isPaid ? "hd" : "default";
  const base = `/api/cards/${cardId}`;
  // Free users start on the Image tab — the one format they can actually use.
  const initialTab: DownloadTab = isPaid ? defaultTab : "png";
  const links: Record<DownloadTab, { href: string; filename: string }> = {
    // The server clamps a free viewer to 750 px anyway; asking for it
    // outright keeps the URL honest about what they get. A PNG always names
    // its corner: the route's default is square (older callers).
    png: {
      href:
        format === "jpeg"
          ? cardJpegHref(cardId, { preset })
          : cardPngHref(cardId, { preset, corners }),
      filename: cardImageFilename(cardSlug, { format, corners }),
    },
    single: { href: `${base}/pdf?layout=card`, filename: `${cardSlug}.pdf` },
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
              <FormatSwitch value={format} onChange={setFormat} />
              <CornersSwitch
                value={corners}
                onChange={setPngCorners}
                isPaid={isPaid}
                format={format}
              />
              {isPaid ? (
                <DownloadPanel
                  title={`High-resolution ${FORMAT_LABEL[format]}`}
                  description={
                    format === "jpeg"
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
                      Low-resolution {FORMAT_LABEL[format]}
                    </h3>
                    <p className="text-xs leading-5 text-muted">
                      750 × 1050 with the PipGlyph mark — fine for sharing and
                      playtesting. Plus and Pro download a clean, print-ready
                      1500 × 2100 image.
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

/** PNG or JPEG (TODO 6.18) — every viewer, free included. */
function FormatSwitch({
  value,
  onChange,
}: {
  value: CardImageFormat;
  onChange: (next: CardImageFormat) => void;
}) {
  return (
    <div className="mb-4 flex flex-col gap-1.5" data-testid="download-format">
      <span className="text-xs font-medium text-foreground">File type</span>
      <ChipGroup
        ariaLabel="File type"
        options={FORMAT_OPTIONS}
        value={value}
        onChange={onChange}
      />
    </div>
  );
}

/** The image's Rounded / Square switch — every viewer, free included. A
 *  JPEG shows Square with Rounded disabled. */
function CornersSwitch({
  value,
  onChange,
  isPaid,
  format,
}: {
  value: CardCorners;
  onChange: (next: CardCorners) => void;
  isPaid: boolean;
  format: CardImageFormat;
}) {
  return (
    <div className="mb-4 flex flex-col gap-1.5" data-testid="download-corners">
      <span className="text-xs font-medium text-foreground">Corners</span>
      <ChipGroup
        ariaLabel="Corners"
        options={cornerOptions(format)}
        value={value}
        onChange={onChange}
      />
      <p className="text-[11px] leading-4 text-subtle">{cornersHint(isPaid, format)}</p>
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
