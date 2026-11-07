import type { Metadata } from "next";
import { ToolShell } from "@/components/tools/tool-shell";
import { TokenKitWorkspace } from "@/components/tools/token-kit/token-kit-workspace";
import { downloadBrandMark, getEntitlements } from "@/lib/billing/entitlements";
import { getVerifiedFrameKeys } from "@/lib/cards/frame-reviews";
import { listMyDecks } from "@/lib/decks/queries";
import { openTool } from "@/lib/tools/queries";
import { listRecentTokenKits } from "@/lib/tools/token-kit/queries";

// ---------------------------------------------------------------------------
// /dashboard/tools/token-kit — the Token Kit beta tool: pick one of your
// decks (or paste a list) and get every token, emblem and helper card it
// makes, drawn as one kit and printed through the print paths. Admins and
// testers while in beta (openTool: a 404 for anyone else). The token list is
// Scryfall's data and free on every plan; printing follows the download
// rules every card follows (a clean print file is a paid download).
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  title: "Token Kit",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function TokenKitPage() {
  const entry = await openTool("token-kit");
  const [decks, recent, verified, entitlements] = await Promise.all([
    listMyDecks(),
    listRecentTokenKits(entry.userId),
    getVerifiedFrameKeys(),
    getEntitlements(),
  ]);
  return (
    <ToolShell entry={entry}>
      <TokenKitWorkspace
        decks={decks.map((deck) => ({
          id: deck.id,
          title: deck.title,
          format: deck.format ?? null,
          cards: deck.cards_count,
          visibility: deck.visibility,
        }))}
        recent={recent}
        verifiedKeys={verified}
        cleanDownloads={!downloadBrandMark(entitlements)}
      />
    </ToolShell>
  );
}
