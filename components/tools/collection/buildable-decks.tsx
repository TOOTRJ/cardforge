import Link from "next/link";
import { Layers } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ColorPips } from "@/components/cards/color-pip";
import { cn } from "@/lib/utils";
import type { BuildableDeck } from "@/lib/tools/collection/queries";
import { collectionViewHref } from "@/lib/tools/collection/views";

const n = (value: number) => value.toLocaleString("en-US");
type Pip = "W" | "U" | "B" | "R" | "G" | "C";
const pipsOf = (identity: readonly string[]): Pip[] =>
  identity.length === 0 ? ["C"] : (identity.filter((c) => "WUBRG".includes(c)) as Pip[]);

/** The community's public Commander decks, closest to what you own first
 *  (collection_buildable_decks, migration 0185: real cards counted against
 *  your collection by name, basics left out — you have those — and a
 *  PipGlyph proxy in the deck counted apart, since nobody owns it). */
export function BuildableDecks({ decks, collectionSize }: { decks: BuildableDeck[]; collectionSize: number }) {
  if (collectionSize === 0) {
    return (
      <EmptyState
        icon={Layers}
        headingLevel={2}
        title="Add your cards first"
        description="Once your collection is in, the public Commander decks closest to what you own show up here — with the cards you'd still need."
        action={
          <Link href={collectionViewHref("add")} className={buttonVariants({ variant: "primary" })}>
            Add cards
          </Link>
        }
      />
    );
  }
  if (decks.length === 0) {
    return (
      <EmptyState
        icon={Layers}
        headingLevel={2}
        title="No public deck shares your cards yet"
        description="As creators share more Commander decks, the ones you can build from your collection appear here."
      />
    );
  }
  return (
    <section aria-labelledby="buildable-title" className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="buildable-title" className="font-display text-xl font-semibold text-foreground">
          Decks you can build
        </h2>
        <p className="text-sm text-muted">
          Public Commander decks, the closest to your collection first. Basic lands don&apos;t count — you have those.
        </p>
      </div>
      <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
        {decks.map((deck) => (
          <li key={deck.deckId} className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-surface/40 p-4">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <Link
                  href={`/deck/${deck.slug}`}
                  className="block truncate font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
                >
                  {deck.title}
                </Link>
                <p className="truncate text-xs text-subtle">
                  {deck.ownerUsername ? `by @${deck.ownerUsername}` : null}
                  {deck.commanders.length > 0 ? ` · ${deck.commanders.join(" & ")}` : null}
                </p>
              </div>
              <ColorPips colors={pipsOf(deck.colorIdentity)} />
            </div>

            <div className="flex flex-col gap-1.5">
              <div
                role="meter"
                aria-label={`Cards of ${deck.title} you own`}
                aria-valuemin={0}
                aria-valuemax={deck.total}
                aria-valuenow={deck.owned}
                aria-valuetext={`${deck.percent}% — ${n(deck.owned)} of ${n(deck.total)} cards`}
                className="h-2 overflow-hidden rounded-full bg-elevated"
              >
                <div
                  className={cn("h-full rounded-full", deck.missing === 0 ? "bg-gold" : "bg-primary-bright")}
                  style={{ width: `${deck.percent}%` }}
                />
              </div>
              <p className="text-sm text-foreground">
                <span className="font-semibold tabular-nums">{deck.percent}%</span>{" "}
                <span className="text-muted">
                  — you own {n(deck.owned)} of {n(deck.total)}
                  {deck.missing > 0 ? `, ${n(deck.missing)} to go` : ". Every card is yours."}
                </span>
              </p>
              <p className="text-xs text-subtle">
                {deck.ownsCommander ? "You own the commander." : "You don't own the commander yet."}
                {deck.proxies > 0
                  ? ` Also ${n(deck.proxies)} PipGlyph card${deck.proxies === 1 ? "" : "s"} (made here, not counted).`
                  : ""}
              </p>
            </div>

            {deck.missingCards.length > 0 ? (
              <details className="group rounded-lg border border-border/60">
                <summary className="cursor-pointer list-none rounded-lg px-3 py-2 text-sm text-foreground hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60 [&::-webkit-details-marker]:hidden">
                  <span className="group-open:hidden">Show the {n(deck.missing)} you&apos;re missing</span>
                  <span className="hidden group-open:inline">Hide the missing cards</span>
                </summary>
                <ul className="flex max-h-64 flex-col gap-0.5 overflow-y-auto px-3 pb-3 text-sm">
                  {deck.missingCards.map((card, i) => (
                    <li key={`${card.name}-${i}`} className="flex justify-between gap-3 text-muted">
                      <span className="min-w-0 truncate">
                        {card.name}
                        {card.commander ? <span className="text-subtle"> (commander)</span> : null}
                      </span>
                      {card.quantity > 1 ? <span className="tabular-nums">×{card.quantity}</span> : null}
                    </li>
                  ))}
                  {deck.missing > deck.missingCards.length ? (
                    <li className="pt-1 text-xs text-subtle">…and {n(deck.missing - deck.missingCards.length)} more on the deck&apos;s page.</li>
                  ) : null}
                </ul>
              </details>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
