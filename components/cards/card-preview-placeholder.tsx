import { cn } from "@/lib/utils";
import type { CardPreview } from "@/types";

type CardPreviewPlaceholderProps = {
  card?: Partial<CardPreview>;
  className?: string;
};

const colorAccent: Record<string, string> = {
  white: "from-amber-200/35 via-amber-100/15",
  blue: "from-sky-400/35 via-sky-300/15",
  black: "from-zinc-700/40 via-zinc-500/10",
  red: "from-rose-500/35 via-rose-400/15",
  green: "from-emerald-500/35 via-emerald-400/15",
  multicolor: "from-fuchsia-400/35 via-amber-300/20",
  colorless: "from-slate-500/30 via-slate-400/15",
};

export function CardPreviewPlaceholder({
  card,
  className,
}: CardPreviewPlaceholderProps) {
  const title = card?.title ?? "Untitled Card";
  const cost = card?.cost ?? "{2}{X}";
  const cardType = card?.cardType ?? "creature";
  const rarity = card?.rarity ?? "rare";
  const color = card?.colorIdentity ?? "multicolor";
  const artistCredit = card?.artistCredit ?? "Unknown Artist";

  return (
    <div
      className={cn(
        "group relative aspect-[5/7] w-full overflow-hidden rounded-frame border border-border-strong/80 bg-linear-to-br from-elevated via-surface to-background p-3 shadow-[0_18px_60px_-30px_rgba(0,0,0,0.8)] transition-transform hover:-translate-y-1",
        className,
      )}
    >
      <div className="flex h-full flex-col gap-2 rounded-card border border-border/60 bg-background/40 p-2 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-2 rounded-md border border-border/40 bg-surface/80 px-3 py-1.5">
          <span className="truncate font-display text-sm font-semibold tracking-wide text-foreground">
            {title}
          </span>
          <span className="rounded-full border border-border/60 bg-elevated px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted">
            {cost}
          </span>
        </div>

        <div
          className={cn(
            "relative flex-1 overflow-hidden rounded-md border border-border/40 bg-linear-to-b",
            colorAccent[color] ?? colorAccent.multicolor,
            "to-background/80",
          )}
        >
          <div className="absolute inset-0 bg-grid opacity-30" aria-hidden />
          <div className="relative flex h-full items-center justify-center p-4 text-center">
            <span className="text-[10px] uppercase tracking-[0.2em] text-subtle">
              Artwork preview
            </span>
          </div>
        </div>

        <div className="rounded-md border border-border/40 bg-surface/80 px-3 py-1.5 text-[11px] text-muted">
          <span className="capitalize text-foreground">{cardType}</span>
          <span className="mx-2 text-subtle">·</span>
          <span className="capitalize">{rarity}</span>
        </div>

        <div className="rounded-md border border-border/40 bg-surface/60 px-3 py-2 text-[11px] leading-5 text-muted">
          <p className="line-clamp-3">
            Generic rules text appears here. Stable structured fields render via
            the live preview as the creator builds out the card.
          </p>
        </div>

        <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-subtle">
          <span>Art: {artistCredit}</span>
          <span>CardForge</span>
        </div>
      </div>
    </div>
  );
}
