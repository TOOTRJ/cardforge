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
//                  PAID viewers also pick the print options (TODO 6.1a/6.1b/
//                  6.1, lib/cards/print-export.ts): Resolution 600 ppi (1500
//                  × 2100) or 800 ppi (2000 × 2800), and the Bleed — None,
//                  1/8″ (2.75″ × 3.75″), or MakePlayingCards (MPC's poker-
//                  size upload: its own bleed, 1644 × 2244 at 600 ppi, a
//                  Battle or Split turned portrait). Any of them is a PRINT
//                  render: square, PNG only (the JPEG chip and Rounded are
//                  disabled while one is on, and the print options while
//                  JPEG is), ?ppi=…&bleed=1|mpc.
//                  800 ppi says when the frame is upscaled
//                  (printFrameUpscaledAt800 — every template, today).
//   PDF          — Layout: One card — a 2.5"×3.5" page sized exactly to the
//                  card; sleeve-ready (Plus+) — or Sheet — a page of copies
//                  on US Letter or A4 (Pro). Sheets take the print options
//                  of My Cards' selection export and the deck export (TODO
//                  6.15, components/cards/print-sheet-options.tsx): spacing,
//                  cut guides (corner marks / full-length lines), card size
//                  (2.5 × 3.5 in / 63 × 88 mm); both layouts the 1/8″ bleed
//                  (a bleed sheet makes room — Letter prints landscape).
//                  The options and the bleed start from the ones this
//                  browser used last (lib/cards/print-selection.ts — shared
//                  with those exports) and are saved on download; the layout
//                  always opens on One card. Links: lib/cards/card-pdf-link.ts.
//   Both faces   — a double-faced card (TODO 5.3; `hasBackFace`: a back with
//                  a body of its own, the one the bake writes): the Image
//                  tab gets a Face switch — Both faces / Front / Back (TODO
//                  5.3c, owner decision 2026-10-05: a two-sided card
//                  downloads BOTH sides unless one is chosen, so Both faces
//                  is first and the default: the front and the back side by
//                  side in ONE PNG with a transparent gap, ?faces=both,
//                  named <slug>-both…; the corners and the free / paid
//                  image apply to it, while the print options and JPEG —
//                  one face each — are disabled with a note until Front or
//                  Back is picked; every option above applies to a single
//                  face chosen: ?face=back, named <slug>-back…); the PDF
//                  tab's One card gets Faces — Front / Back / Both faces (2
//                  pages) — and its Sheet the shared "Include back faces"
//                  checkbox (the back beside its front, on by default;
//                  remembered with the other print settings). A
//                  single-faced card's modal is exactly what it was.
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
  type PrintBleed,
  type PrintPpi,
} from "@/lib/cards/print-export";
import { cardPdfFilename, cardPdfHref, type CardPdfFaces, type CardPdfLayout } from "@/lib/cards/card-pdf-link";
import { faceSlug, type CardFace, type DownloadFaces } from "@/lib/cards/card-face";
import {
  DEFAULT_PRINT_SELECTION_SETTINGS,
  loadPrintSelectionSettings,
  savePrintSelectionSettings,
  type PrintSelectionSettings,
} from "@/lib/cards/print-selection";
import { planSheet } from "@/lib/render/sheet-layout";
import { PrintBacksCheckbox, PrintBleedCheckbox, SheetOptionsFields } from "@/components/cards/print-sheet-options";
import { cn } from "@/lib/utils";

const FORMAT_OPTIONS: ChipOption<CardImageFormat>[] = [
  { value: "png", label: "PNG" },
  { value: "jpeg", label: "JPEG" },
];

const FORMAT_LABEL: Record<CardImageFormat, string> = { png: "PNG", jpeg: "JPEG" };

/** The Image tab's Face switch (TODO 5.3): both faces in one image first
 *  (5.3c, the default), then either face alone. */
const FACE_OPTIONS: ChipOption<DownloadFaces>[] = [
  { value: "both", label: "Both faces" },
  { value: "front", label: "Front" },
  { value: "back", label: "Back" },
];

/** Why the print options are off: a JPEG (PNG only), or both faces in one
 *  image (a print file is one face each — TODO 5.3c). */
const PRINT_OFF_NOTE = {
  jpeg: "800 ppi and bleed are PNG only.",
  both: "Print files come one face at a time — pick Front or Back.",
} as const;

/** The PDF tab's Faces switch for One card (TODO 5.3). */
const PDF_FACE_OPTIONS: ChipOption<CardPdfFaces>[] = [
  { value: "front", label: "Front" },
  { value: "back", label: "Back" },
  { value: "both", label: "Both faces (2 pages)" },
];

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
  /** A double-faced card with a back of its own (TODO 5.3, lib/cards/faces.ts
   *  rowHasBakedBack): the Face / Faces switches and "Include back faces"
   *  show. Default false — a single-faced card's modal is unchanged. */
  hasBackFace?: boolean;
};

type DownloadTab = "png" | "single";

/** The PDF tab's layout: one card on its own page, or a sheet of copies. */
type PdfLayoutChoice = "card" | "sheet";

type SheetPaperLayout = Exclude<CardPdfLayout, "card">;

const PAPER_OPTIONS: ChipOption<SheetPaperLayout>[] = [
  { value: "sheet-letter", label: "US Letter" },
  { value: "sheet-a4", label: "A4" },
];

/** The paper a remembered layout names (one per page → Letter). */
function sheetPaperOf(settings: PrintSelectionSettings): SheetPaperLayout {
  return settings.layout === "sheet-a4" ? "sheet-a4" : "sheet-letter";
}

export function DownloadModal({
  cardId,
  cardSlug,
  trigger,
  defaultTab = "single",
  isPaid = false,
  canBatch = false,
  downloadDiffersFromGallery = false,
  frameTemplate,
  hasBackFace = false,
}: DownloadModalProps) {
  const upgrade = useUpgradeModal();
  // PNG first; its corner Rounded first, like the card in the gallery. A
  // JPEG is always square — the PNG's choice is kept for switching back.
  const [format, setFormat] = useState<CardImageFormat>("png");
  const [pngCorners, setPngCorners] = useState<CardCorners>("round");
  // The face (TODO 5.3): the Image tab opens on BOTH faces in one image
  // (5.3c — a two-sided card downloads both sides unless one is chosen; a
  // single-faced card never reads it), the PDF tab on the front; a sheet's
  // backs follow the remembered print settings (includeBacks).
  const [face, setFace] = useState<DownloadFaces>("both");
  const [pdfFaces, setPdfFaces] = useState<CardPdfFaces>("front");
  // Print options (paid; TODO 6.1a/6.1b/6.1): a print render is square + PNG.
  const [ppi, setPpi] = useState<PrintPpi>(DEFAULT_PRINT_PPI);
  const [bleed, setBleed] = useState<PrintBleed>(false);
  // The PDF tab (TODO 6.15): the layout opens on One card; the sheet's
  // paper and options and the bleed start from the settings this browser
  // printed with last (loaded as the dialog opens — never during SSR).
  const [open, setOpen] = useState(false);
  const [pdfLayout, setPdfLayout] = useState<PdfLayoutChoice>("card");
  const [pdfSettings, setPdfSettings] = useState<PrintSelectionSettings>(DEFAULT_PRINT_SELECTION_SETTINGS);
  const patchPdf = (next: Partial<PrintSelectionSettings>) => setPdfSettings((prev) => ({ ...prev, ...next }));
  const onOpenChange = (next: boolean) => {
    if (next) {
      setPdfSettings(loadPrintSelectionSettings());
      setPdfLayout("card");
      setFace("both");
      setPdfFaces("front");
    }
    setOpen(next);
  };
  const sheetLayout = sheetPaperOf(pdfSettings);
  // Sheets are Pro: a Plus viewer always gets the one-card page.
  const pdfChoice: PdfLayoutChoice = canBatch ? pdfLayout : "card";
  const pdfBleed = isPaid && pdfSettings.bleed;
  const sheetOptions = { gap: pdfSettings.gap, marks: pdfSettings.marks, cardSize: pdfSettings.cardSize };
  const sheetPlan = planSheet(sheetLayout === "sheet-a4" ? "a4" : "letter", { ...sheetOptions, bleed: pdfBleed });
  // Which face(s) the PDF holds: One card follows the Faces switch; a
  // sheet carries the back beside its front unless "Include back faces" is
  // off. A single-faced card's PDF is the front, as ever.
  const pdfFaceChoice: CardPdfFaces = !hasBackFace
    ? "front"
    : pdfChoice === "sheet"
      ? pdfSettings.includeBacks
        ? "both"
        : "front"
      : pdfFaces;
  const pdfLink = {
    layout: pdfChoice === "sheet" ? sheetLayout : ("card" as CardPdfLayout),
    bleed: pdfBleed,
    // Named only for a double-faced card: a single-faced card's link and
    // file name are exactly what they were.
    ...(hasBackFace ? { faces: pdfFaceChoice } : {}),
  };
  // Remember what this PDF was printed with (the paper only for a sheet).
  const rememberPdf = () =>
    savePrintSelectionSettings(pdfChoice === "sheet" ? { ...pdfSettings, layout: sheetLayout } : pdfSettings);
  // 800 ppi follows PRINT_800_PPI_PAID_ONLY (the open 6.1b [decide]); the
  // bleed is always a clean-download feature.
  const can800 = isPaid || !PRINT_800_PPI_PAID_ONLY;
  const printOptions = { ppi: can800 ? ppi : DEFAULT_PRINT_PPI, bleed: isPaid ? bleed : false };
  // Both faces in one image (TODO 5.3c) — only a card with a back has the
  // choice: a PNG, never a print file or a JPEG (one face each), so while
  // it is picked the format reads PNG and no print option is sent; the
  // viewer's JPEG and print picks are kept for a single face.
  const bothFaces = hasBackFace && face === "both";
  const imageFormat: CardImageFormat = bothFaces ? "png" : format;
  const print = !bothFaces && imageFormat === "png" && isPrintRequest(printOptions);
  const corners = print ? "square" : effectiveCorners(imageFormat, pngCorners);
  const preset = isPaid ? "hd" : "default";
  // Free users start on the Image tab — the one format they can actually use.
  const initialTab: DownloadTab = isPaid ? defaultTab : "png";
  // The Image tab's ONE face: the back only on a card that has one (TODO
  // 5.3) — its files are named <slug>-back…, its links carry &face=back.
  const imageFace: CardFace = hasBackFace && face !== "both" ? face : "front";
  const imageSlug = faceSlug(cardSlug, bothFaces ? "both" : imageFace);
  const links: Record<DownloadTab, { href: string; filename: string }> = {
    // The server clamps a free viewer to 750 px anyway; asking for it
    // outright keeps the URL honest about what they get. A PNG always names
    // its corner: the route's default is square (older callers).
    png: bothFaces
      ? {
          // The two faces side by side: &faces=both, named <slug>-both….
          href: cardPngHref(cardId, { preset, corners, face: "both" }),
          filename: cardImageFilename(imageSlug, { format: "png", corners }),
        }
      : print
      ? {
          href: cardPrintPngHref(cardId, { ...printOptions, face: imageFace }),
          filename: cardPrintFilename(imageSlug, printOptions),
        }
      : {
          href:
            imageFormat === "jpeg"
              ? cardJpegHref(cardId, { preset, face: imageFace })
              : cardPngHref(cardId, { preset, corners, face: imageFace }),
          filename: cardImageFilename(imageSlug, { format: imageFormat, corners }),
        },
    single: {
      href: cardPdfHref(cardId, { ...pdfLink, sheet: sheetOptions }),
      filename: cardPdfFilename(cardSlug, pdfLink),
    },
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
            Pick a format. Sheets carry cut guides; cut along them for
            sleeve-ready cards.
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
                PDF is a Plus feature; print sheets are Pro.
              </p>
            ) : null}

            <TabsContent value="png" className="mt-5">
              {hasBackFace ? <FaceSwitch value={face} onChange={setFace} /> : null}
              <FormatSwitch value={imageFormat} onChange={setFormat} jpegDisabled={print || bothFaces} />
              <CornersSwitch
                value={corners}
                onChange={setPngCorners}
                isPaid={isPaid}
                format={imageFormat}
                print={print}
              />
              {can800 ? (
                <PrintOptions
                  ppi={ppi}
                  onPpiChange={setPpi}
                  bleed={bleed}
                  onBleedChange={isPaid ? setBleed : null}
                  disabled={bothFaces ? "both" : imageFormat === "jpeg" ? "jpeg" : null}
                  frameUpscaled={printFrameUpscaledAt800(frameTemplate)}
                />
              ) : null}
              {isPaid ? (
                <DownloadPanel
                  title={
                    bothFaces
                      ? "High-resolution PNG — both faces"
                      : print
                        ? printTitle(printOptions)
                        : `High-resolution ${FORMAT_LABEL[imageFormat]}`
                  }
                  description={
                    bothFaces
                      ? "Clean, full-resolution (1500 × 2100 per face) render of the front and the back side by side in one PNG, a transparent gap between them. Rounded for sharing and embedding; Square for printing."
                      : print
                        ? printDescription(printOptions, printFrameUpscaledAt800(frameTemplate))
                        : imageFormat === "jpeg"
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
                      {bothFaces
                        ? "Low-resolution PNG — both faces"
                        : print
                          ? printTitle(printOptions)
                          : `Low-resolution ${FORMAT_LABEL[imageFormat]}`}
                    </h3>
                    <p className="text-xs leading-5 text-muted">
                      {bothFaces
                        ? "750 × 1050 per face with the PipGlyph mark, the front and the back side by side in one PNG — fine for sharing and playtesting. Plus and Pro download it clean at 1500 × 2100 per face."
                        : print
                          ? // Only when PRINT_800_PPI_PAID_ONLY is off: a free
                            // viewer's 800 ppi file keeps the mark (the bleed
                            // stays paid, so this is never a bleed file).
                            `${freePrintSize(printOptions.ppi)} with the PipGlyph mark, square — for printing and playtesting. Plus and Pro download it clean, with an optional 1/8″ bleed or MakePlayingCards' size.`
                          : "750 × 1050 with the PipGlyph mark — fine for sharing and playtesting. Plus and Pro download a clean, print-ready 1500 × 2100 image."}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button asChild variant="outline">
                      <a href={links.png.href} download={links.png.filename}>
                        <Download className="h-4 w-4" aria-hidden /> Download
                        free {FORMAT_LABEL[imageFormat]}
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
                <div className="mb-4 flex flex-col gap-4" data-testid="download-pdf-options">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-foreground">Layout</span>
                    <ChipGroup
                      ariaLabel="PDF layout"
                      options={[
                        { value: "card", label: "One card" },
                        { value: "sheet", label: "Sheet of copies", disabled: !canBatch },
                      ]}
                      value={pdfChoice}
                      onChange={setPdfLayout}
                    />
                    {!canBatch ? (
                      <p className="flex flex-wrap items-center gap-x-2 text-[11px] leading-4 text-subtle">
                        Print sheets are a Pro feature.
                        <button
                          type="button"
                          className="font-medium text-primary-bright underline-offset-2 hover:underline"
                          onClick={() => upgrade.open("batch_export")}
                        >
                          See Pro
                        </button>
                      </p>
                    ) : null}
                  </div>
                  {hasBackFace && pdfChoice === "card" ? (
                    <div className="flex flex-col gap-1.5" data-testid="download-pdf-faces">
                      <span className="text-xs font-medium text-foreground">Faces</span>
                      <ChipGroup ariaLabel="Faces" options={PDF_FACE_OPTIONS} value={pdfFaces} onChange={setPdfFaces} />
                    </div>
                  ) : null}
                  {pdfChoice === "sheet" ? (
                    <>
                      <div className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-foreground">Paper</span>
                        <ChipGroup
                          ariaLabel="Paper"
                          options={PAPER_OPTIONS}
                          value={sheetLayout}
                          onChange={(layout) => patchPdf({ layout })}
                        />
                      </div>
                      <SheetOptionsFields
                        value={sheetOptions}
                        onChange={patchPdf}
                        className="gap-3 sm:grid-cols-1"
                      />
                      {hasBackFace ? (
                        <PrintBacksCheckbox
                          checked={pdfSettings.includeBacks}
                          onChange={(next) => patchPdf({ includeBacks: next })}
                          testId="download-pdf-backs"
                          hint="The back printed beside its front: every pair of cells is one whole card."
                        />
                      ) : null}
                    </>
                  ) : null}
                  <PrintBleedCheckbox
                    checked={pdfBleed}
                    onChange={(next) => patchPdf({ bleed: next })}
                    testId="download-pdf-bleed"
                    hint={
                      pdfChoice === "sheet"
                        ? "Each card runs 1/8″ past its trim; the guides mark the trim. Fewer cards fit on a sheet."
                        : "The page grows to 2.75″ × 3.75″ plus a margin, with crop marks on the trim line."
                    }
                  />
                </div>
              ) : null}
              {pdfChoice === "sheet" ? (
                <DownloadPanel
                  title={`Print sheet — ${sheetLayout === "sheet-a4" ? "A4" : "US Letter"}`}
                  description={sheetDescription(sheetLayout, sheetPlan, pdfSettings.marks, pdfBleed, pdfFaceChoice === "both")}
                  href={links.single.href}
                  filename={links.single.filename}
                  onDownload={rememberPdf}
                />
              ) : (
                <DownloadPanel
                  title={pdfFaceChoice === "both" ? "Both faces PDF" : pdfFaceChoice === "back" ? "Back face PDF" : "Single card PDF"}
                  description={
                    pdfFaceChoice === "both"
                      ? "Two pages, the front then the back, each sized exactly to a standard MTG card (2.5″ × 3.5″ / 63.5 × 88.9 mm)."
                      : "One page sized exactly to a standard MTG card (2.5″ × 3.5″ / 63.5 × 88.9 mm). Drop it into a 9-pocket page or print onto card stock and cut."
                  }
                  href={links.single.href}
                  filename={links.single.filename}
                  locked={!isPaid}
                  onUpgrade={() => upgrade.open("pdf_export")}
                  onDownload={rememberPdf}
                />
              )}
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Both faces, Front or Back (TODO 5.3 / 5.3c) — a double-faced card, every
 *  viewer. */
function FaceSwitch({ value, onChange }: { value: DownloadFaces; onChange: (next: DownloadFaces) => void }) {
  return (
    <div className="mb-4 flex flex-col gap-1.5" data-testid="download-face">
      <span className="text-xs font-medium text-foreground">Face</span>
      <ChipGroup ariaLabel="Face" options={FACE_OPTIONS} value={value} onChange={onChange} />
      <p className="text-[11px] leading-4 text-subtle">
        {value === "both"
          ? "The front and the back side by side in one PNG, named <card>-both. Pick a face for a single image, a JPEG or a print file."
          : value === "back"
            ? "The back face, named <card>-back."
            : "The front face. Switch to Back for the other side."}
      </p>
    </div>
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

/** The Bleed choice's chip values. */
type BleedChoice = "none" | "eighth" | "mpc";

const BLEED_OPTIONS: ChipOption<BleedChoice>[] = [
  { value: "none", label: "None" },
  { value: "eighth", label: "1/8″" },
  { value: "mpc", label: "MakePlayingCards" },
];

const bleedChoiceOf = (bleed: PrintBleed): BleedChoice => (bleed === "mpc" ? "mpc" : bleed ? "eighth" : "none");
const bleedOfChoice = (choice: BleedChoice): PrintBleed => (choice === "mpc" ? "mpc" : choice === "eighth");

/** "800 ppi PNG with bleed", "PNG with bleed", "800 ppi PNG", "PNG for
 *  MakePlayingCards". */
function printTitle(opts: { ppi: PrintPpi; bleed: PrintBleed }): string {
  const res = opts.ppi === DEFAULT_PRINT_PPI ? "" : `${opts.ppi} ppi `;
  if (opts.bleed === "mpc") return `${res}PNG for MakePlayingCards`;
  return `${res}PNG${opts.bleed ? " with 1/8″ bleed" : ""} for print`;
}

/** "2000 × 2800 (800 ppi)" — a free viewer's print file (no bleed). */
function freePrintSize(ppi: PrintPpi): string {
  const { width, height } = printPixelSize(ppi, { bleed: false });
  return `${width} × ${height} (${ppi} ppi)`;
}

function printDescription(opts: { ppi: PrintPpi; bleed: PrintBleed }, frameUpscaled: boolean): string {
  const trimSize = printPixelSize(opts.ppi, { bleed: false });
  const trim = `${trimSize.width} × ${trimSize.height}`;
  const out = printPixelSize(opts.ppi, { bleed: opts.bleed });
  const size = `${out.width} × ${out.height}`;
  const parts = [
    `Clean ${size} render with square corners, the art at full resolution.`,
    opts.bleed === "mpc"
      ? `MakePlayingCards' poker-size upload (822 × 1122 at 300 dpi, here at ${opts.ppi}): the card (${trim} at the trim) plus MPC's bleed, ${out.bleedX} px on every side. A Battle or Split is turned onto MPC's portrait card, its title up the left edge.`
      : opts.bleed
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

/** Resolution + bleed (paid; TODO 6.1a/6.1b/6.1) — PNG only, one face at a
 *  time: off (with the reason) for a JPEG or for both faces in one image. */
function PrintOptions({
  ppi,
  onPpiChange,
  bleed,
  onBleedChange,
  disabled: disabledBy,
  frameUpscaled,
}: {
  ppi: PrintPpi;
  onPpiChange: (next: PrintPpi) => void;
  bleed: PrintBleed;
  /** Null: no bleed for this viewer (it follows the clean download). */
  onBleedChange: ((next: PrintBleed) => void) | null;
  /** Why the options are off, or null when they are on. */
  disabled: keyof typeof PRINT_OFF_NOTE | null;
  frameUpscaled: boolean;
}) {
  const disabled = disabledBy !== null;
  const choice = disabled ? "none" : bleedChoiceOf(bleed);
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
          {disabledBy
            ? PRINT_OFF_NOTE[disabledBy]
            : frameUpscaled
              ? "800 ppi draws the text and art sharper; the frame itself is upscaled."
              : "800 ppi for print shops that ask for it."}
        </p>
      </div>
      {onBleedChange ? (
        <div className="flex flex-col gap-1.5" data-testid="download-bleed">
          <span className="text-xs font-medium text-foreground">Bleed</span>
          <ChipGroup
            ariaLabel="Bleed"
            options={BLEED_OPTIONS.map((option) => ({ ...option, disabled }))}
            value={choice}
            onChange={(next) => onBleedChange(bleedOfChoice(next))}
          />
          <p className="text-[11px] leading-4 text-subtle">
            {choice === "mpc"
              ? "Sized for MakePlayingCards' poker-size cards: MPC's own bleed, always portrait."
              : "1/8″ extends the card past the trim on every side (2.75″ × 3.75″) for print shops."}
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** What a single-card sheet holds: "6 copies per sheet (landscape page) on
 *  US Letter, full-length cut lines…". */
function sheetDescription(
  layout: SheetPaperLayout,
  plan: ReturnType<typeof planSheet>,
  marks: PrintSelectionSettings["marks"],
  bleed: boolean,
  withBacks = false,
): string {
  const paper = layout === "sheet-a4" ? "an A4 (210 × 297 mm)" : "a US Letter (8.5″ × 11″)";
  const guides = marks === "lines" ? "full-length cut lines" : "corner crop marks";
  const stock = layout === "sheet-a4" ? "250 g/m² card stock" : "110 lb. card stock";
  // With backs, every pair of cells is one whole card (TODO 5.3).
  const copies = withBacks
    ? `${Math.floor(plan.perPage / 2)} copies of this card, each face beside the other,`
    : `${plan.perPage} copies of this card`;
  return `${copies} on ${paper} page${plan.orientation === "landscape" ? ", printed landscape" : ""}, with ${guides}${bleed ? " on the trim lines" : ""}. Recommended paper: ${stock}.`;
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
  onDownload,
}: {
  title: string;
  description: string;
  href: string;
  filename: string;
  locked?: boolean;
  onUpgrade?: () => void;
  /** Runs as the download starts (the PDF remembers its options). */
  onDownload?: () => void;
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
          <a href={href} download={filename} onClick={onDownload}>
            <Download className="h-4 w-4" aria-hidden /> Download
          </a>
        </Button>
      )}
    </div>
  );
}
