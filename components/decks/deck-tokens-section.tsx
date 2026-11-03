import { Sparkles } from "lucide-react";
import { listDeckTokens } from "@/lib/decks/deck-tokens-server";
import { TOKEN_TEXT_NOTE, type DeckToken, type TokenSourceItem } from "@/lib/decks/deck-tokens";

// ---------------------------------------------------------------------------
// "Tokens & emblems" (TODO DK5.16): what the deck's cards make, listed for
// play — display only, never deck entries. The rows are the VIEWER's
// (a "Private card" makes nothing). Streams in under its own Suspense
// boundary: the real cards' answer may wait on Scryfall (cached a day,
// lib/decks/deck-tokens-server.ts). Nothing made: no section.
// ---------------------------------------------------------------------------

export const DECK_TOKENS_HEADING_ID = "deck-tokens-title";

export async function DeckTokensSection({ items }: { items: readonly TokenSourceItem[] }) {
  const { tokens, realCardsFailed } = await listDeckTokens(items);
  return <DeckTokensList tokens={tokens} realCardsFailed={realCardsFailed} />;
}

/** The list itself (pure, for tests and the section above). */
export function DeckTokensList({ tokens, realCardsFailed }: { tokens: readonly DeckToken[]; realCardsFailed: boolean }) {
  if (tokens.length === 0) return null;
  const tokenCount = tokens.filter((t) => t.kind === "token").length;
  const emblemCount = tokens.length - tokenCount;
  const summary = [
    tokenCount > 0 ? `${tokenCount} token${tokenCount === 1 ? "" : "s"}` : null,
    emblemCount > 0 ? `${emblemCount} emblem${emblemCount === 1 ? "" : "s"}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <section aria-labelledby={DECK_TOKENS_HEADING_ID} className="mt-14 flex max-w-7xl flex-col gap-4">
      <div className="flex flex-col gap-1 border-b border-gold/20 pb-4">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-gold-strong">
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          For the table
        </span>
        <h2 id={DECK_TOKENS_HEADING_ID} className="flex items-baseline gap-2 font-display text-2xl font-semibold tracking-tight text-foreground">
          Tokens &amp; emblems
          <span className="font-sans text-sm font-normal tabular-nums text-subtle">
            <span className="sr-only">, </span>
            {summary}
          </span>
        </h2>
        <p className="max-w-2xl text-sm leading-6 text-muted">What this deck&apos;s cards make — listed here, never added to the deck.</p>
      </div>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {tokens.map((token) => (
          <li key={token.key} className="flex min-w-0 gap-3 rounded-frame border border-border/60 bg-surface/60 p-3">
            {token.imageUrl ? (
              // A Scryfall token printing's "small" picture (cards.scryfall.io
              // has no rate limit) — the list's own size, never the HD scan.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={token.imageUrl}
                alt=""
                loading="lazy"
                decoding="async"
                width={73}
                height={102}
                className="h-[102px] w-[73px] shrink-0 rounded-[4px] bg-[#101015] object-cover"
              />
            ) : (
              <div
                aria-hidden
                className="flex h-[102px] w-[73px] shrink-0 items-center justify-center rounded-[4px] border border-dashed border-border bg-surface/40 text-[10px] font-semibold uppercase tracking-wider text-subtle"
              >
                {token.kind === "emblem" ? "Emblem" : "Token"}
              </div>
            )}
            <div className="flex min-w-0 flex-col gap-0.5 text-sm">
              <span className="font-semibold text-foreground">{token.name}</span>
              {token.typeLine ? <span className="text-xs text-muted">{token.typeLine}</span> : null}
              {token.details ? <span className="text-xs text-muted">{token.details}</span> : null}
              <span className="mt-1 text-xs text-subtle">
                Made by {token.makers.join(", ")}
              </span>
            </div>
          </li>
        ))}
      </ul>
      <p className="max-w-3xl text-xs leading-5 text-subtle">
        {TOKEN_TEXT_NOTE}
        {realCardsFailed ? " Real cards' tokens couldn't be loaded just now — they'll be back on a later visit." : ""}
      </p>
    </section>
  );
}
