"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BULK_CUSTOMIZE_MAX_CARDS, type BulkSource } from "@/lib/tools/bulk-customize/model";
import type { BulkCustomizeDialogProps } from "./bulk-customize-dialog";

// The dialog's code loads on the first press (a page that ticks cards pays
// nothing for it until then). The button itself is on screen at load, so it
// is a plain import wherever it sits.
const BulkCustomizeDialog = dynamic<BulkCustomizeDialogProps>(() =>
  import("./bulk-customize-dialog").then((mod) => mod.BulkCustomizeDialog),
);

/**
 * "Customize" for a selection of REAL cards. One card opens the creator
 * pre-filled with its printing (`oneCardHref`), as a deck entry's Customize
 * does; several open the Bulk Customize dialog. Render it only where the
 * viewer has the tool (`getViewerTool("bulk-customize")`).
 */
export function BulkCustomizeButton({
  sources,
  oneCardHref,
  surface,
  onFinished,
  size = "sm",
  variant = "primary",
  className,
}: {
  sources: BulkSource[];
  /** The creator's address for a selection of one (null: always the dialog). */
  oneCardHref: string | null;
  surface: BulkCustomizeDialogProps["surface"];
  onFinished?: () => void;
  size?: "sm" | "md";
  variant?: "primary" | "outline";
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false);
  // The opener's onFinished runs when the dialog CLOSES after a batch — run
  // at once it would clear the selection that holds this button, and the
  // dialog would vanish with its results.
  const finished = useRef(false);
  const count = sources.length;
  const tooMany = count > BULK_CUSTOMIZE_MAX_CARDS;
  const offReason =
    count === 0 ? "Tick some real cards first." : tooMany ? `Pick ${BULK_CUSTOMIZE_MAX_CARDS} cards or fewer.` : null;

  return (
    <>
      <Button
        type="button"
        size={size}
        variant={variant}
        className={className}
        aria-disabled={offReason ? true : undefined}
        title={offReason ?? undefined}
        onClick={() => {
          if (offReason) return;
          if (count === 1 && oneCardHref) {
            router.push(oneCardHref);
            return;
          }
          setOpened(true);
          setOpen(true);
        }}
      >
        <Layers className="h-4 w-4" aria-hidden />
        {count > 1 ? `Customize ${count}` : "Customize"}
        {offReason ? <span className="sr-only"> — {offReason}</span> : null}
      </Button>
      {opened ? (
        <BulkCustomizeDialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next && finished.current) {
              finished.current = false;
              setOpened(false);
              onFinished?.();
            }
          }}
          sources={sources.slice(0, BULK_CUSTOMIZE_MAX_CARDS)}
          surface={surface}
          onFinished={() => {
            finished.current = true;
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}
