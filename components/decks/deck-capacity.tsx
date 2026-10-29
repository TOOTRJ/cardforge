"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Crown, Globe2, Info, Loader2, OctagonAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DeleteDeckDialog } from "@/components/decks/delete-deck-dialog";
import { useUpgradeModal } from "@/components/billing/upgrade-modal-provider";
import { updateDeckAction } from "@/lib/decks/actions";
import {
  deckCapacityFull,
  deckUsageLabel,
  describeDeckCapacity,
  describeDeckUsage,
  overDeckCapacity,
  type DeckCapacity,
} from "@/lib/billing/deck-capacity-copy";
import { VISIBILITY_LABELS, type Visibility } from "@/types/card";
import { planForTier } from "@/lib/billing/plans";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// The private-deck cap, shown (TODO DK3.3; owner decision D1: Free 1, Plus 3,
// Pro unlimited PRIVATE or UNLISTED decks, public decks unlimited). The copy
// comes from lib/billing/deck-capacity-copy so every surface agrees; the
// database enforces the cap (migration 0145).
//
//   DeckCapacityMeter    "Private decks: 1 of 1" — My Decks today; exported
//                        for the account menu (its rewrite lands separately:
//                        it renders `variant="compact"` with the same
//                        capacity). At the cap it offers the three ways out:
//                        make a deck public, delete one (there is no archive),
//                        or upgrade.
//   DeckCapacityNotice   before a deck is made or turned private / unlisted
//                        (the create flow, the deck details form): says so
//                        while there is something to say, with the same ways
//                        out. Never blocks by itself — the server decides.
// ---------------------------------------------------------------------------

const TONE_CLASS = {
  danger: "border-danger/50 bg-danger/10",
  warning: "border-gold/50 bg-gold/10",
  info: "border-border/60 bg-elevated/40",
} as const;

const TONE_ICON = { danger: OctagonAlert, warning: AlertTriangle, info: Info } as const;

const BAR_CLASS = { danger: "bg-danger", warning: "bg-gold", info: "bg-primary" } as const;

export type CappedDeck = { id: string; title: string; visibility: Visibility };

export function DeckCapacityMeter({
  capacity,
  cappedDecks,
  variant = "full",
  className,
}: {
  capacity: DeckCapacity | null;
  /** The owner's private + unlisted decks: at the cap each one gets "Make
   *  public" and "Delete". Without them the ways out are links. */
  cappedDecks?: readonly CappedDeck[];
  /** "compact" = the label and the bar only (the account menu). */
  variant?: "full" | "compact";
  className?: string;
}) {
  const usage = describeDeckUsage(capacity);
  const label = deckUsageLabel(capacity);
  if (!capacity || !usage || !label) return null;
  const fill = capacity.cap > 0 ? Math.min(100, Math.round((capacity.used / capacity.cap) * 100)) : 100;
  const bar = (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-elevated" aria-hidden>
      <span className={cn("block h-full rounded-full", BAR_CLASS[usage.tone])} style={{ width: `${fill}%` }} />
    </span>
  );

  if (variant === "compact") {
    return (
      <div className={cn("flex flex-col gap-1", className)}>
        <span className="flex items-center justify-between gap-2 text-xs">
          <span className="font-medium text-foreground">{label}</span>
          <span className="text-subtle">{planForTier(capacity.tier).name}</span>
        </span>
        {bar}
      </div>
    );
  }

  const Icon = TONE_ICON[usage.tone];
  const full = deckCapacityFull(capacity);
  return (
    <section
      aria-label="Private decks"
      data-testid="deck-capacity-meter"
      className={cn("flex flex-col gap-3 rounded-lg border px-4 py-3 text-sm", TONE_CLASS[usage.tone], className)}
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <p className="leading-6 text-foreground">
            <span className="font-semibold">{label}</span>
            <span className="text-muted"> · {usage.message}</span>
          </p>
          <span className="max-w-xs">{bar}</span>
        </div>
      </div>
      {full ? <WaysOut capacity={capacity} cappedDecks={cappedDecks} /> : null}
    </section>
  );
}

/** The three ways out at the cap (TODO DK3.3): make a deck public, delete
 *  one, or upgrade. */
function WaysOut({
  capacity,
  cappedDecks,
}: {
  capacity: DeckCapacity;
  cappedDecks?: readonly CappedDeck[];
}) {
  const upgrade = useUpgradeModal();
  // A deck over the cap (a lapsed plan) needs more than one freed.
  const freeing = overDeckCapacity(capacity) + 1;
  const which = cappedDecks?.length ? "of these" : "of your private decks";
  return (
    <div className="flex flex-col gap-2 border-t border-border/50 pt-3">
      <p className="text-xs leading-5 text-muted">
        {`To make another private deck, make ${freeing === 1 ? "one" : freeing} ${which} public or delete ${freeing === 1 ? "it" : "them"} — or upgrade. Your decks are never locked.`}
      </p>
      {cappedDecks && cappedDecks.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border/40" aria-label="Your private and unlisted decks">
          {cappedDecks.map((deck) => (
            <li key={deck.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2">
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                {deck.title}
                <span className="ml-2 text-xs text-subtle">{VISIBILITY_LABELS[deck.visibility]}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                <MakeDeckPublicButton deckId={deck.id} deckTitle={deck.title} />
                <DeleteDeckDialog
                  deckId={deck.id}
                  deckTitle={deck.title}
                  triggerLabel="Delete"
                  triggerVariant="ghost"
                  triggerSize="sm"
                  triggerAriaLabel={`Delete ${deck.title}`}
                />
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" onClick={() => upgrade.open("deck_capacity")}>
          <Crown className="h-4 w-4" aria-hidden />
          Upgrade for more private decks
        </Button>
        {cappedDecks ? null : (
          <Link href="/dashboard/decks" className="text-xs font-semibold text-primary-bright underline-offset-2 hover:underline">
            Manage your decks
          </Link>
        )}
      </div>
    </div>
  );
}

/** One deck made public — a way out of the cap. Reversible: a public deck can
 *  be made private again while the plan has room. */
function MakeDeckPublicButton({ deckId, deckTitle }: { deckId: string; deckTitle: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={pending}
      aria-label={`Make ${deckTitle} public`}
      onClick={() =>
        startTransition(async () => {
          const result = await updateDeckAction(deckId, { visibility: "public" });
          if (!result.ok) {
            toast.error(result.formError ?? Object.values(result.fieldErrors ?? {})[0] ?? "Couldn't change the deck.");
            return;
          }
          toast.success(`“${deckTitle}” is public — one private slot is free.`);
          router.refresh();
        })
      }
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Globe2 className="h-4 w-4" aria-hidden />}
      Make public
    </Button>
  );
}

export function DeckCapacityNotice({
  capacity,
  visibility,
  alreadyCounted = false,
  onMakePublic,
  className,
}: {
  capacity: DeckCapacity | null;
  /** The visibility the deck is about to get. */
  visibility: string;
  /** The deck is private or unlisted already (an edit): it holds its slot. */
  alreadyCounted?: boolean;
  /** Switches THIS deck to public — the first way out. */
  onMakePublic?: () => void;
  className?: string;
}) {
  const upgrade = useUpgradeModal();
  const notice = describeDeckCapacity(capacity, visibility, alreadyCounted);
  if (!notice) return null;
  const Icon = TONE_ICON[notice.tone];
  const blocked = notice.tone === "danger";
  return (
    // A status, never an alert: it reads once, politely, as the choice
    // changes (a refused save is the form's one alert).
    <div
      role="status"
      data-testid="deck-capacity-notice"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-4 py-3 text-sm text-foreground",
        TONE_CLASS[notice.tone],
        className,
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 leading-6">{notice.message}</span>
      {blocked ? (
        <span className="flex shrink-0 flex-wrap items-center gap-3 text-xs font-semibold">
          {onMakePublic ? (
            <button type="button" onClick={onMakePublic} className="underline-offset-2 hover:underline">
              Make it public
            </button>
          ) : null}
          <Link href="/dashboard/decks" className="underline-offset-2 hover:underline">
            Manage decks
          </Link>
          <button
            type="button"
            onClick={() => upgrade.open("deck_capacity")}
            className="text-primary-bright underline-offset-2 hover:underline"
          >
            Upgrade
          </button>
        </span>
      ) : null}
    </div>
  );
}
