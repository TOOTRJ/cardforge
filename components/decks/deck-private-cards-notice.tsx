"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Globe, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";
import { updateCardsVisibilityAction } from "@/lib/cards/actions";
import { strongLanguageSkippedLine } from "@/lib/cards/bulk-visibility-copy";
import Link from "next/link";
import {
  HIDDEN_BY_MODERATION_LABEL,
  MODERATION_CONTACT_HREF,
  moderationLockedSkippedLine,
} from "@/lib/moderation/lock";

// ---------------------------------------------------------------------------
// Private cards in a deck others can open (owner decision D11, TODO DK5.17)
// — the OWNER's warning: a private card of theirs may sit in a public (or
// unlisted) deck, and the deck's visitors see a "Private card" tile in its
// place (lib/decks/private-card-name.ts), never its title or art, and never
// in the hero's fan (lib/decks/featured.ts). "Make public" is the site's own
// visibility change (updateCardsVisibilityAction — My Cards' bulk bar uses
// it): its rules hold here too, so a card whose text holds strong language
// stays private (owner policy 2026-10-28) and the toast says why. A card
// moderation hid (migration 0156, lib/moderation/lock.ts) is listed with
// "Hidden by moderation" and no button — it stays private until an admin
// unhides it — and is never part of "Make all public".
// ---------------------------------------------------------------------------

/** Past this many cards the list folds behind "Show all". */
const SHOWN = 5;

export function DeckPrivateCardsNotice({
  cards,
  deckVisibility,
}: {
  cards: Array<{ id: string; title: string; moderationLocked?: boolean }>;
  deckVisibility: "public" | "unlisted";
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? cards : cards.slice(0, SHOWN);
  const offerable = cards.filter((card) => !card.moderationLocked);
  const anyLocked = offerable.length < cards.length;

  const makePublic = (ids: string[], key: string) => {
    setBusy(key);
    startTransition(async () => {
      const result = await updateCardsVisibilityAction(ids, "public");
      setBusy(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const published = result.count === 1 ? "1 card is public now." : `${result.count} cards are public now.`;
      toast.success(
        [published, strongLanguageSkippedLine(result.skippedLanguage), moderationLockedSkippedLine(result.skippedModeration)]
          .filter(Boolean)
          .join(" "),
      );
      router.refresh();
    });
  };

  const who = deckVisibility === "public" ? "This deck is public" : "Anyone with this deck's link can open it";
  return (
    <SurfaceCard className="flex flex-col gap-3 border-gold/40 bg-gold/5 p-4 sm:p-5" role="region" aria-labelledby="deck-private-cards-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="deck-private-cards-title" className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Lock className="h-4 w-4 text-gold" aria-hidden />
            {cards.length === 1 ? "1 of your cards here is private" : `${cards.length} of your cards here are private`}
          </h2>
          <p className="text-sm leading-6 text-muted">
            {who}, but visitors see a “Private card” tile in place of {cards.length === 1 ? "it" : "each"} — never
            its name or art. Make {cards.length === 1 ? "it" : "them"} public to show your work.
            {anyLocked ? (
              <>
                {" "}A card hidden by moderation stays private until our team reviews it —{" "}
                <Link href={MODERATION_CONTACT_HREF} className="font-medium text-primary-bright underline-offset-4 hover:underline">
                  contact us
                </Link>{" "}
                with questions.
              </>
            ) : null}
          </p>
        </div>
        {offerable.length > 1 ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => makePublic(offerable.map((card) => card.id), "all")}
          >
            {busy === "all" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Globe className="h-3.5 w-3.5" aria-hidden />}
            Make all {offerable.length} public
          </Button>
        ) : null}
      </div>
      <ul className="flex flex-col divide-y divide-border/40 rounded-md border border-border/60 bg-surface/60">
        {shown.map((card) => (
          <li key={card.id} className="flex items-center justify-between gap-3 px-3 py-2">
            <span className="min-w-0 truncate text-sm text-foreground">{card.title}</span>
            {card.moderationLocked ? (
              <span className="shrink-0 text-xs text-muted">{HIDDEN_BY_MODERATION_LABEL}</span>
            ) : (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={isPending}
              onClick={() => makePublic([card.id], card.id)}
              aria-label={`Make ${card.title} public`}
              className="shrink-0"
            >
              {busy === card.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Globe className="h-3.5 w-3.5" aria-hidden />}
              Make public
            </Button>
            )}
          </li>
        ))}
      </ul>
      {cards.length > SHOWN ? (
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
          className="self-start rounded-sm text-xs font-medium text-primary-bright underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50"
        >
          {expanded ? "Show fewer" : `Show all ${cards.length}`}
        </button>
      ) : null}
    </SurfaceCard>
  );
}
