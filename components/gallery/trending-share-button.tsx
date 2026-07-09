"use client";

import { Share2 } from "lucide-react";
import { ShareTargets } from "@/components/cards/share-targets";

// Client wrapper that constructs the custom share-icon trigger entirely on
// the client side. Passing the trigger JSX as a prop from a server component
// caused a hydration mismatch because Radix's <DialogTrigger asChild> uses
// Slot.Clone to merge its own aria-* attributes onto the child, and the
// SSR pass didn't reflect those attributes the same way the client did.

type TrendingShareButtonProps = {
  cardId: string;
  cardTitle: string;
  cardUrl: string;
  /** Absolute origin, for the native-share image attachment. */
  siteBase: string;
};

export function TrendingShareButton({
  cardId,
  cardTitle,
  cardUrl,
  siteBase,
}: TrendingShareButtonProps) {
  return (
    <ShareTargets
      title={cardTitle}
      url={cardUrl}
      entity="card"
      itemId={cardId}
      imageUrl={`${siteBase}/api/cards/${cardId}/og`}
      trigger={
        <button
          type="button"
          aria-label={`Share ${cardTitle}`}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-background/85 text-foreground backdrop-blur transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50"
        >
          <Share2 className="h-4 w-4" aria-hidden />
        </button>
      }
    />
  );
}
