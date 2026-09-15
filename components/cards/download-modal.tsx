"use client";

// ---------------------------------------------------------------------------
// DownloadModal
//
// One dialog covering every "get the card off the screen" path:
//
//   PNG          — render of the card (free: 750 px with the PipGlyph mark;
//                  paid: clean 1500 × 2100).
//   Single PDF   — 2.5"×3.5" page sized exactly to the card; sleeve-ready. (Plus+)
//   3×3 Letter   — 9 copies on US Letter with corner crop marks. (Pro)
//   3×3 A4       — 9 copies on A4 with corner crop marks. (Pro)
//
// A free viewer gets exactly ONE live option — the low-resolution
// watermarked PNG — and sees the other formats greyed out (owner decision
// 2026-09-15); the upgrade CTA sits on the PNG panel. Paid tabs are gated by
// the viewer's plan (enforced server-side too). Available formats are plain
// anchors with `download` so the browser saves the file without a
// client-side fetch.
// ---------------------------------------------------------------------------

import { type ReactNode } from "react";
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
import { PremiumBadge } from "@/components/billing/premium-badge";
import { useUpgradeModal } from "@/components/billing/upgrade-modal-provider";
import { cn } from "@/lib/utils";

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
};

type DownloadTab = "png" | "single" | "letter" | "a4";

export function DownloadModal({
  cardId,
  cardSlug,
  trigger,
  defaultTab = "single",
  isPaid = false,
  canBatch = false,
}: DownloadModalProps) {
  const upgrade = useUpgradeModal();
  const base = `/api/cards/${cardId}`;
  // Free users start on the PNG tab — the one format they can actually use.
  const initialTab: DownloadTab = isPaid ? defaultTab : "png";
  const links: Record<DownloadTab, { href: string; filename: string }> = {
    // The server clamps a free viewer to 750 px anyway; asking for it
    // outright keeps the URL honest about what they get.
    png: {
      href: `${base}/png?preset=${isPaid ? "hd" : "default"}`,
      filename: `${cardSlug}.png`,
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
                PNG
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
              {isPaid ? (
                <DownloadPanel
                  title="High-resolution PNG"
                  description="Clean, full-resolution (1500 × 2100) render. Great for sharing, embedding, and printing single cards."
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
                      Low-resolution PNG
                    </h3>
                    <p className="text-xs leading-5 text-muted">
                      750 × 1050 with the PipGlyph mark — fine for sharing and
                      playtesting. Plus and Pro download a clean, print-ready
                      1500 × 2100 PNG.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button asChild variant="outline">
                      <a href={links.png.href} download={links.png.filename}>
                        <Download className="h-4 w-4" aria-hidden /> Download
                        free PNG
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
