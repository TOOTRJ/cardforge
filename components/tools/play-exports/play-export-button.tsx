"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Gamepad2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PlayExportDialogProps } from "./play-export-dialog";

// The dialog's code (and JSZip) loads on the first press: a deck page or My
// Cards pays nothing for it until then. The button itself is on screen at
// load, so it is a plain import wherever it sits.
const PlayExportDialog = dynamic<PlayExportDialogProps>(() =>
  import("./play-export-dialog").then((mod) => mod.PlayExportDialog),
);

/**
 * "Play online" — the play-surface exports (beta tool `play-exports`) for a
 * deck or a selection of cards. Render it only where the viewer has the tool
 * (`getViewerTool("play-exports")`); the action checks again.
 */
export function PlayExportButton({
  source,
  label,
  size = "sm",
  className,
  disabledReason = null,
  nameSuffix = null,
}: {
  source: PlayExportDialogProps["source"];
  /** What the dialog says it exports ("Wolf Pack", "3 cards"). */
  label: string;
  size?: "sm" | "md";
  className?: string;
  /** Why it can't export right now (nothing picked); null = ready. */
  disabledReason?: string | null;
  /** Read after "Play online" by a screen reader, where several such
   *  buttons share a list ("Play online: Wolf Pack"). */
  nameSuffix?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={size}
        className={cn(className)}
        aria-disabled={disabledReason ? true : undefined}
        title={disabledReason ?? undefined}
        onClick={() => {
          if (disabledReason) return;
          setOpened(true);
          setOpen(true);
        }}
      >
        <Gamepad2 className="h-4 w-4" aria-hidden />
        Play online
        {nameSuffix ? <span className="sr-only">: {nameSuffix}</span> : null}
        {disabledReason ? <span className="sr-only"> — {disabledReason}</span> : null}
      </Button>
      {opened ? <PlayExportDialog open={open} onOpenChange={setOpen} source={source} label={label} /> : null}
    </>
  );
}
