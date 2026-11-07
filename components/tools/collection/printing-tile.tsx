import { cardCornersClass } from "@/lib/cards/card-orientation";
import { entryPrintingImage } from "@/lib/decks/entry-image";
import { cn } from "@/lib/utils";

/** A real card's printing on its own 5:7 tile (Scryfall's picture, as the
 *  deck page draws a printing) — or its name on a blank face when Scryfall
 *  has no picture. Decorative: the caption beside it names the card. */
export function PrintingPicture({
  imageUrl,
  name,
  size = "normal",
  className,
}: {
  imageUrl: string | null;
  name: string;
  size?: "small" | "normal";
  className?: string;
}) {
  const src = entryPrintingImage(imageUrl, size);
  return (
    <div
      aria-hidden
      className={cn(
        "relative aspect-[5/7] w-full overflow-hidden border border-border/40 bg-[#101015] shadow-[0_18px_60px_-30px_rgba(0,0,0,0.85)]",
        cardCornersClass(false),
        className,
      )}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- Scryfall's own CDN, sized by the URL
        <img src={src} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center p-3 text-center font-display text-sm text-muted">
          {name}
        </span>
      )}
    </div>
  );
}
