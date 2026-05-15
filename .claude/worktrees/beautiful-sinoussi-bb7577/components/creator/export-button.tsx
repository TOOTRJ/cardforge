"use client";

import { useTransition } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { exportCardAction } from "@/lib/cards/export";
import type { RenderPreset } from "@/lib/render/card-image";

type ExportButtonProps = {
  cardId: string;
  cardSlug: string;
  preset?: RenderPreset;
  variant?: "primary" | "secondary" | "outline" | "ghost" | "accent";
  size?: "sm" | "md" | "lg";
  label?: string;
  className?: string;
};

export function ExportButton({
  cardId,
  cardSlug,
  preset = "hd",
  variant = "secondary",
  size = "md",
  label,
  className,
}: ExportButtonProps) {
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    startTransition(async () => {
      const result = await exportCardAction(cardId, preset);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `Exported ${cardSlug}.png · ${result.width}×${result.height}`,
        {
          action: {
            label: "Open",
            onClick: () => window.open(result.fileUrl, "_blank", "noopener"),
          },
        },
      );

      // Trigger a real download by clicking an anchor with `download`
      // attribute — works cross-browser without leaving the page.
      const anchor = document.createElement("a");
      anchor.href = result.fileUrl;
      anchor.download = `${cardSlug}.png`;
      anchor.rel = "noopener";
      // Adding to DOM is needed for Firefox.
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    });
  };

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={handleClick}
      disabled={isPending}
      className={className}
    >
      {isPending ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <Download className="h-4 w-4" aria-hidden />
      )}
      {isPending ? "Rendering…" : (label ?? "Download PNG")}
    </Button>
  );
}
