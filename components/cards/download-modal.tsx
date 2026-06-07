"use client";

// ---------------------------------------------------------------------------
// DownloadModal
//
// One dialog covering every "get the card off the screen" path:
//
//   PNG          — render of the card (free: watermarked + capped; paid: clean HD).
//   Single PDF   — 2.5"×3.5" page sized exactly to the card; sleeve-ready. (Plus+)
//   3×3 Letter   — 9 copies on US Letter with corner crop marks. (Pro)
//   3×3 A4       — 9 copies on A4 with corner crop marks. (Pro)
//
// PNG is always available. PDF/sheet formats are gated by the viewer's plan
// (enforced server-side too); locked tabs open the upgrade modal instead of
// downloading. Available formats are plain anchors with `download` so the
// browser saves the file without a client-side fetch.
// ---------------------------------------------------------------------------

import { type ReactNode } from "react";
import { Crown, Download, FileImage, FileText, Grid3X3 } from "lucide-react";
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
    png: { href: `${base}/png?preset=hd`, filename: `${cardSlug}.png` },
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
              <TabsTrigger value="single">
                <FileText className="h-3.5 w-3.5" aria-hidden />
                PDF
              </TabsTrigger>
              <TabsTrigger value="letter">
                <Grid3X3 className="h-3.5 w-3.5" aria-hidden />
                3×3 Letter
              </TabsTrigger>
              <TabsTrigger value="a4">
                <Grid3X3 className="h-3.5 w-3.5" aria-hidden />
                3×3 A4
              </TabsTrigger>
            </TabsList>

            <TabsContent value="png" className="mt-5">
              <DownloadPanel
                title="High-resolution PNG"
                description={
                  isPaid
                    ? "Clean, full-resolution (1500 × 2100) render. Great for sharing, embedding, and printing single cards."
                    : "Free PNG export (with a small watermark). Upgrade for watermark-free, full-resolution downloads."
                }
                href={links.png.href}
                filename={links.png.filename}
              />
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
