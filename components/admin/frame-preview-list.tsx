"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { CardPreview, type CardPreviewData } from "@/components/cards/card-preview";
import { deleteFramePreviewCardAction } from "@/lib/cards/frame-signoff-actions";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// The walked preview cards of one frame (TODO 2.3), listed under their
// template in the verification checklist and beside each colour in the
// sign-off view: "Re-verify" reopens the saved card in the stepper (preview
// mode, today's frame), "Delete" removes it (a two-click confirm; the action
// deletes flagged previews only). Rows arrive serialised from the server.
// ---------------------------------------------------------------------------

export type FramePreviewListItem = {
  id: string;
  title: string;
  colorKey: string;
  createdAt: string;
  /** The stepper reopened on this card; null when another admin owns it
   *  (the editor only opens your own cards). */
  editHref: string | null;
  /** The live render (sign-off view only). */
  previewData?: CardPreviewData;
};

function DeleteButton({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [pending, startTransition] = useTransition();
  const run = () =>
    startTransition(async () => {
      const result = await deleteFramePreviewCardAction({ cardId: id });
      if (!result.ok) {
        toast.error(result.error);
        setArmed(false);
        return;
      }
      toast.success(`Deleted the preview “${title}”.`);
      router.refresh();
    });
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => (armed ? run() : setArmed(true))}
      onBlur={() => setArmed(false)}
      aria-label={armed ? `Confirm deleting the preview ${title}` : `Delete the preview ${title}`}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
        armed
          ? "border-danger/60 bg-danger/10 text-foreground"
          : "border-border/50 text-muted hover:border-border-strong hover:text-foreground",
      )}
    >
      {pending ? (
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
      ) : (
        <Trash2 className="h-3 w-3" aria-hidden />
      )}
      {armed ? "Confirm" : "Delete"}
    </button>
  );
}

export function FramePreviewList({
  items,
  showRender = false,
  className,
}: {
  items: FramePreviewListItem[];
  showRender?: boolean;
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <ul className={cn("flex flex-col gap-2", className)} data-testid="frame-preview-list">
      {items.map((item) => (
        <li
          key={item.id}
          className="flex items-center gap-3 text-xs"
          data-testid="frame-preview-item"
        >
          {showRender && item.previewData ? (
            <div className="w-28 shrink-0">
              <CardPreview {...item.previewData} />
            </div>
          ) : null}
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate text-foreground">{item.title}</span>
            <span className="text-[10px] uppercase tracking-wider text-subtle">
              {item.colorKey} · {item.createdAt.slice(0, 10)}
              {item.editHref ? "" : " · another admin's"}
            </span>
          </span>
          {item.editHref ? (
            <Link
              href={item.editHref}
              title="Reopen this preview card in the stepper, on today's frame, to walk it again."
              className="inline-flex shrink-0 items-center rounded-md border border-border/50 px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:border-border-strong hover:text-foreground"
            >
              Re-verify
            </Link>
          ) : null}
          <DeleteButton id={item.id} title={item.title} />
        </li>
      ))}
    </ul>
  );
}
