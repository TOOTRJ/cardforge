import { DeckBetaBannerView, type DeckBetaBannerProps } from "@/components/decks/deck-beta-banner-view";
import { deckBetaBannerLive } from "@/lib/decks/beta-banner";

// ---------------------------------------------------------------------------
// The deck builder's beta banner (TODO DK10.2) — deck page and My Decks only
// (both render per request). A SERVER component: it decides whether the
// banner is still live (`DECK_BETA_BANNER_ENDS_AT`) once, on the server, and
// the browser half (`DeckBetaBannerView`) never reads the clock — so the
// server's HTML and the hydrating client can't disagree at the end date.
// ---------------------------------------------------------------------------

export function DeckBetaBanner(props: DeckBetaBannerProps) {
  if (!deckBetaBannerLive()) return null;
  return <DeckBetaBannerView {...props} />;
}
