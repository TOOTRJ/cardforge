"use client";

import { useState, useTransition } from "react";
import {
  ClipboardCopy,
  Download,
  FileText,
  Loader2,
  Printer,
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
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// DeckExportMenu — the deck owner's export hub:
//   Copy decklist (Arena / plain text)         — free
//   Print PDF (pages / 3×3 letter / 3×3 A4)    — Pro
//   Download PNGs as ZIP                       — Pro
// The decklist text variants are precomputed server-side and passed in;
// PDF/ZIP stream from the API routes (fetch → blob so a 403 shows a toast
// instead of a JSON page).
// ---------------------------------------------------------------------------

type DeckExportMenuProps = {
  deckId: string;
  deckSlug: string;
  /** Precomputed decklist text variants (see lib/decks/export-text.ts). */
  arenaText: string;
  plainText: string;
  /** Whether the viewer's plan includes batch export (Pro). */
  allowBatchExport: boolean;
};

export function DeckExportMenu({
  deckId,
  deckSlug,
  arenaText,
  plainText,
  allowBatchExport,
}: DeckExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const copyText = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied to your clipboard.`);
    } catch {
      toast.error("Couldn't access the clipboard.");
    }
  };

  const downloadFile = (key: string, url: string, filename: string) => {
    if (!allowBatchExport) {
      toast.error("Whole-deck export is a Pro feature.");
      return;
    }
    setBusy(key);
    startTransition(async () => {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;
          toast.error(body?.error ?? "Export failed — try again.");
          return;
        }
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = filename;
        anchor.click();
        URL.revokeObjectURL(objectUrl);
        toast.success("Export ready — check your downloads.");
      } catch {
        toast.error("Export failed — try again.");
      } finally {
        setBusy(null);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Download className="h-4 w-4" aria-hidden /> Export
        </Button>
      </DialogTrigger>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Export this deck</DialogTitle>
          <DialogDescription>
            Copy the list as text, or print your custom proxies. Real cards
            never print — they&apos;re listed on a checklist page instead.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          <section className="flex flex-col gap-2">
            <SectionLabel>Copy decklist</SectionLabel>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => copyText("Arena decklist", arenaText)}
              >
                <ClipboardCopy className="h-3.5 w-3.5" aria-hidden />
                Arena format
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => copyText("Decklist", plainText)}
              >
                <FileText className="h-3.5 w-3.5" aria-hidden />
                Plain text
              </Button>
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <SectionLabel>
              Print custom proxies
              {!allowBatchExport ? <ProBadge /> : null}
            </SectionLabel>
            <div className="flex flex-wrap gap-2">
              <ExportButton
                label="One per page"
                icon={<FileText className="h-3.5 w-3.5" aria-hidden />}
                pending={busy === "pages"}
                dimmed={!allowBatchExport}
                onClick={() =>
                  downloadFile(
                    "pages",
                    `/api/decks/${deckId}/export?layout=pages`,
                    `${deckSlug}.pdf`,
                  )
                }
              />
              <ExportButton
                label="3×3 sheets · Letter"
                icon={<Printer className="h-3.5 w-3.5" aria-hidden />}
                pending={busy === "sheet-letter"}
                dimmed={!allowBatchExport}
                onClick={() =>
                  downloadFile(
                    "sheet-letter",
                    `/api/decks/${deckId}/export?layout=sheet&paper=letter`,
                    `${deckSlug}-sheets.pdf`,
                  )
                }
              />
              <ExportButton
                label="3×3 sheets · A4"
                icon={<Printer className="h-3.5 w-3.5" aria-hidden />}
                pending={busy === "sheet-a4"}
                dimmed={!allowBatchExport}
                onClick={() =>
                  downloadFile(
                    "sheet-a4",
                    `/api/decks/${deckId}/export?layout=sheet&paper=a4`,
                    `${deckSlug}-sheets-a4.pdf`,
                  )
                }
              />
            </div>
            <p className="text-[11px] leading-4 text-muted">
              Sheets repeat each card by its deck quantity, with crop marks
              for cutting. Un-remixed cards appear on a checklist page.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <SectionLabel>
              Save images
              {!allowBatchExport ? <ProBadge /> : null}
            </SectionLabel>
            <div className="flex flex-wrap gap-2">
              <ExportButton
                label="Download PNGs (.zip)"
                icon={<Download className="h-3.5 w-3.5" aria-hidden />}
                pending={busy === "zip"}
                dimmed={!allowBatchExport}
                onClick={() =>
                  downloadFile(
                    "zip",
                    `/api/decks/${deckId}/download`,
                    `${deckSlug}-cards.zip`,
                  )
                }
              />
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-subtle">
      {children}
    </span>
  );
}

function ProBadge() {
  return (
    <Badge variant="accent" className="text-[10px]">
      Pro
    </Badge>
  );
}

function ExportButton({
  label,
  icon,
  pending,
  dimmed,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  pending: boolean;
  dimmed: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={onClick}
      className={cn(dimmed && "opacity-60")}
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      ) : (
        icon
      )}
      {label}
    </Button>
  );
}
