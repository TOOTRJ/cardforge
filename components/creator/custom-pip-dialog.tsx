"use client";

import { Palette } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CustomPipsManager } from "@/components/creator/custom-pips-manager";
import type { PipOverrides } from "@/lib/pips/override";
import { useGuestGate } from "@/components/creator/guest-pictures";

// ---------------------------------------------------------------------------
// CustomPipDialog — the "Customize pips" button that sits next to the mana
// cost picker. Opens the per-symbol upload manager; the picker itself is
// untouched (only its icons change once an override exists).
// ---------------------------------------------------------------------------

const TRIGGER_CLASS =
  "inline-flex items-center gap-1.5 self-start rounded-md border border-border/40 bg-elevated/60 px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:border-border-strong hover:text-foreground";

export function CustomPipDialog({ overrides }: { overrides: PipOverrides }) {
  // Custom pips are kept with an account: the guest creator's button opens
  // its sign-up dialog instead (TODO HM3).
  const gate = useGuestGate();
  if (gate) {
    return (
      <button type="button" onClick={() => gate("pips")} className={TRIGGER_CLASS}>
        <Palette className="h-3.5 w-3.5 text-gold-strong" aria-hidden />
        Customize pips
      </button>
    );
  }
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" className={TRIGGER_CLASS}>
          <Palette className="h-3.5 w-3.5 text-gold-strong" aria-hidden />
          Customize pips
        </button>
      </DialogTrigger>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Custom pips</DialogTitle>
          <DialogDescription>
            Upload your own icon for any core mana symbol. It replaces the
            standard icon on your cards — in the editor, the gallery, and
            exports. Everything else works exactly the same.
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-y-auto px-5 py-4">
          <CustomPipsManager overrides={overrides} />
          <p className="mt-3 text-[11px] leading-4 text-subtle">
            Square images work best — they&apos;re cropped to a circle at
            256×256. PNG, JPEG, or WebP up to 4 MB.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
