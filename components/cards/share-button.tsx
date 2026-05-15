"use client";

// ---------------------------------------------------------------------------
// ShareButton
//
// A "Share / Embed" button for the public card detail page.
// Opens a popover with:
//   1. Direct card URL (copy-to-clipboard)
//   2. iframe embed snippet (copy-to-clipboard)
//
// This is a client component so it can access navigator.clipboard and
// manage the open/close state without server round-trips.
// ---------------------------------------------------------------------------

import { useState, useRef, useEffect } from "react";
import { Check, Code2, Copy, Link2, Share2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ShareButtonProps = {
  cardTitle: string;
  cardUrl: string; // absolute URL, e.g. "https://spellwright.gg/card/ember-drake"
  variant?: "primary" | "secondary" | "ghost" | "outline" | "accent" | "link";
};

export function ShareButton({
  cardTitle,
  cardUrl,
  variant = "ghost" as const,
}: ShareButtonProps) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  const embedCode = `<iframe\n  src="${cardUrl}/embed"\n  width="240"\n  height="336"\n  style="border:none;border-radius:8px;overflow:hidden;"\n  title="${cardTitle} — Spellwright"\n  loading="lazy"\n></iframe>`;

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  return (
    <div className="relative">
      <Button
        variant={variant}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Share2 className="h-4 w-4" aria-hidden />
        Share
      </Button>

      {open ? (
        <div
          ref={dialogRef}
          role="dialog"
          aria-label="Share this card"
          className="absolute left-0 top-full z-50 mt-2 w-80 rounded-frame border border-border bg-surface shadow-[0_20px_60px_-20px_rgba(0,0,0,0.7)] sm:left-auto sm:right-0"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
            <h3 className="font-display text-sm font-semibold text-foreground">
              Share this card
            </h3>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="rounded p-1 text-muted hover:bg-elevated hover:text-foreground"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>

          {/* Body */}
          <div className="flex flex-col gap-4 p-4">
            {/* Direct link */}
            <ShareField
              label="Card link"
              icon={<Link2 className="h-3.5 w-3.5" aria-hidden />}
              value={cardUrl}
              copyValue={cardUrl}
              mono
            />

            {/* Embed code */}
            <ShareField
              label="Embed code"
              icon={<Code2 className="h-3.5 w-3.5" aria-hidden />}
              value={embedCode}
              copyValue={embedCode}
              mono
              multiline
            />

            <p className="text-[10px] leading-4 text-subtle">
              Fan-made tool · Not affiliated with Wizards of the Coast ·
              Original frames and assets
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Individual copy field
// ---------------------------------------------------------------------------

function ShareField({
  label,
  icon,
  value,
  copyValue,
  mono = false,
  multiline = false,
}: {
  label: string;
  icon: React.ReactNode;
  value: string;
  copyValue: string;
  mono?: boolean;
  multiline?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(copyValue);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select the text for the user to copy manually
      const el = document.querySelector<HTMLElement>(`[data-copy="${label}"]`);
      el?.focus();
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-subtle">
        {icon}
        {label}
      </div>
      <div className="flex items-start gap-2">
        {multiline ? (
          <pre
            data-copy={label}
            className={cn(
              "min-w-0 flex-1 overflow-x-auto rounded-md border border-border/60 bg-background/60 px-2.5 py-2 text-[10px] leading-5",
              mono ? "font-mono" : "",
              "text-foreground",
            )}
          >
            {value}
          </pre>
        ) : (
          <input
            data-copy={label}
            readOnly
            value={value}
            onFocus={(e) => e.target.select()}
            className={cn(
              "h-8 min-w-0 flex-1 rounded-md border border-border/60 bg-background/60 px-2.5 text-xs text-foreground",
              mono ? "font-mono" : "",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50",
            )}
          />
        )}
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? "Copied!" : `Copy ${label}`}
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-colors",
            copied
              ? "border-green-500/60 bg-green-500/15 text-green-400"
              : "border-border bg-elevated text-muted hover:border-border-strong hover:text-foreground",
          )}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Copy className="h-3.5 w-3.5" aria-hidden />
          )}
        </button>
      </div>
    </div>
  );
}
