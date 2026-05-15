"use client";

// ---------------------------------------------------------------------------
// PrintButton
//
// Triggers a PDF download for a given card via /api/cards/[id]/pdf.
// Two variants are exposed via a small dropdown:
//
//   • "Download card PDF"   — single 2.5"×3.5" card, one per page
//   • "Print sheet (9-up)"  — nine copies tiled on US Letter with crop marks
//
// The download is a plain <a href="..." download> click — no server action
// needed because the /api route is a GET endpoint that streams the PDF
// directly to the browser.
// ---------------------------------------------------------------------------

import { useState, useRef, useEffect } from "react";
import { ChevronDown, FileDown, Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PrintButtonProps = {
  cardId: string;
  cardSlug: string;
  variant?: "primary" | "secondary" | "outline" | "ghost" | "accent";
  size?: "sm" | "md" | "lg";
  className?: string;
};

export function PrintButton({
  cardId,
  cardSlug,
  variant = "outline",
  size = "md",
  className,
}: PrintButtonProps) {
  const [open, setOpen] = useState(false);
  const [downloading, setDownloading] = useState<"card" | "sheet" | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click-outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  const triggerDownload = (sheet: boolean) => {
    const which = sheet ? "sheet" : "card";
    setDownloading(which);
    setOpen(false);

    const url = `/api/cards/${cardId}/pdf${sheet ? "?sheet=true" : ""}`;
    const filename = sheet ? `${cardSlug}-sheet.pdf` : `${cardSlug}.pdf`;

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();

    // Give the browser a moment to start the download before clearing state.
    // We can't actually know when a streaming download completes, so we reset
    // after a short delay.
    setTimeout(() => setDownloading(null), 2500);
  };

  const isPending = downloading !== null;

  return (
    <div ref={menuRef} className={cn("relative", className)}>
      <Button
        type="button"
        variant={variant}
        size={size}
        onClick={() => setOpen((v) => !v)}
        disabled={isPending}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Printer className="h-4 w-4" aria-hidden />
        )}
        {isPending ? "Preparing PDF…" : "Print / PDF"}
        {!isPending && (
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 transition-transform",
              open ? "rotate-180" : "",
            )}
            aria-hidden
          />
        )}
      </Button>

      {open && (
        <div
          role="menu"
          aria-label="PDF export options"
          className="absolute left-0 top-full z-50 mt-1.5 min-w-[220px] rounded-frame border border-border bg-surface shadow-[0_16px_48px_-12px_rgba(0,0,0,0.6)]"
        >
          <MenuItem
            icon={<FileDown className="h-4 w-4 shrink-0" aria-hidden />}
            label="Download card PDF"
            description="Single card · 2.5″ × 3.5″ page"
            onClick={() => triggerDownload(false)}
          />
          <MenuItem
            icon={<Printer className="h-4 w-4 shrink-0" aria-hidden />}
            label="Print sheet (9-up)"
            description="9 copies on US Letter · crop marks included"
            onClick={() => triggerDownload(true)}
          />
          <div className="border-t border-border/60 px-3 py-2">
            <p className="text-[10px] leading-4 text-subtle">
              Fan-made tool · Not affiliated with Wizards of the Coast ·
              For personal, non-commercial use only.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Menu item
// ---------------------------------------------------------------------------

function MenuItem({
  icon,
  label,
  description,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-elevated first:rounded-t-frame last:rounded-b-frame focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50"
    >
      <span className="mt-0.5 text-muted">{icon}</span>
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-xs text-muted">{description}</span>
      </span>
    </button>
  );
}
