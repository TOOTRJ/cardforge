import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { after } from "next/server";
import { ArrowLeft } from "lucide-react";
import { PageContainer } from "@/components/layout/page-container";
import { deckTilePips } from "@/components/decks/deck-tile";
import { TableSheet, type TableSheetDeck } from "@/components/tools/rule0/table-sheet";
import { TableSheetEditor } from "@/components/tools/rule0/table-sheet-editor";
import { PrintSheetButton } from "@/components/tools/rule0/print-sheet-button";
import { Badge } from "@/components/ui/badge";
import { isDesignAiConfigured } from "@/lib/ai/provider";
import { deckCoverColors } from "@/lib/decks/cover";
import { viewerDeckBreakdown } from "@/lib/decks/deck-charts";
import { commanderBracket } from "@/lib/decks/deck-types";
import { getDeckBySlugWithOwner, listDeckPageCards } from "@/lib/decks/queries";
import { findRenamedDeckSlug } from "@/lib/decks/slug-history";
import { qrPath } from "@/lib/qr/qr-path";
import { getSiteBaseUrl } from "@/lib/site-url";
import { getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { recordToolEvent } from "@/lib/tools/events";
import { checkToolAccess } from "@/lib/tools/queries";
import { EMPTY_TABLE_SHEET, RULE0_TOOL_SLUG, tableSheetPath } from "@/lib/tools/rule0/model";
import { getTableSheet } from "@/lib/tools/rule0/queries";
import { buildTableSheetFacts } from "@/lib/tools/rule0/sheet";
import { DECK_FORMAT_LABELS } from "@/types/deck";

// ---------------------------------------------------------------------------
// /deck/<slug>/table-sheet — the Rule 0 table sheet (beta tool `rule0-sheet`,
// migration 0190). ONE URL: the deck's OWNER edits it here (while the tool
// is open to them — else a 404, the tool's rule); anyone else reads it only
// when the owner SHARED it, the deck reads for them (public, or unlisted by
// this very link) and the tool is still open to the owner — the table's read
// policy; otherwise a 404, before anything renders.
//
// Everything on the sheet but the owner's words is derived from the deck AS
// THIS VIEWER READS IT (listDeckPageCards → publicDeckItems through
// viewerDeckBreakdown: a visitor's private card is "Private card"), its
// statuses through deckEntryStatus. The QR code points at the deck page,
// and only for a deck others can open — never a private one.
// ---------------------------------------------------------------------------

type Params = { slug: string };

export const dynamic = "force-dynamic";

async function renamedOrNotFound(slug: string): Promise<never> {
  const current = await findRenamedDeckSlug(slug);
  if (current) permanentRedirect(tableSheetPath(current));
  notFound();
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const deck = isSupabaseConfigured() ? await getDeckBySlugWithOwner(slug) : null;
  if (!deck) notFound();
  return {
    title: `Table sheet · ${deck.title}`,
    description: `The Rule 0 table sheet for ${deck.title}: its bracket, game plan and custom cards, before you play.`,
    // A sheet is for the table, never the index.
    robots: { index: false, follow: false },
    alternates: { canonical: tableSheetPath(deck.slug) },
  };
}

export default async function TableSheetPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const [deck, user] = await Promise.all([
    isSupabaseConfigured() ? getDeckBySlugWithOwner(slug) : null,
    getCurrentUser(),
  ]);
  if (!deck) await renamedOrNotFound(slug);
  if (!deck) notFound();

  const isOwner = Boolean(user && user.id === deck.owner_id);
  const [access, sheet, items] = await Promise.all([
    isOwner ? checkToolAccess(RULE0_TOOL_SLUG) : null,
    getTableSheet(deck.id, deck.slug),
    listDeckPageCards(deck.id),
  ]);
  // The owner: while the tool is open to them. Anyone else: a shared sheet
  // the read policy hands them (it checks the deck and the owner's access).
  if (isOwner ? !access : !sheet?.shared) notFound();

  const { shownItems } = viewerDeckBreakdown(items, isOwner);
  const facts = buildTableSheetFacts(shownItems, isOwner, {
    slug: deck.slug,
    format: deck.format,
    bracket: deck.bracket ?? null,
    ownerUsername: deck.owner?.username ?? null,
  });
  const bracket = deck.format === "commander" ? commanderBracket(deck.bracket) : null;
  const sheetDeck: TableSheetDeck = {
    title: deck.title,
    formatLabel: DECK_FORMAT_LABELS[deck.format],
    ownerUsername: deck.owner?.username ?? null,
    bracket: bracket ? { level: bracket.level, name: bracket.name } : null,
    isCommander: deck.format === "commander",
    colors: deckTilePips(deckCoverColors(items)),
  };
  const base = getSiteBaseUrl();
  const deckUrl = `${base}/deck/${deck.slug}`;
  // Never a code that sends a stranger to a deck they can't open.
  const qr = deck.visibility === "private" ? null : { url: deckUrl, path: qrPath(deckUrl) };

  const userId = user?.id ?? null;
  after(() =>
    recordToolEvent({
      slug: RULE0_TOOL_SLUG,
      userId,
      event: isOwner ? "open" : "shared_view",
      access: isOwner ? (access?.via ?? null) : null,
      props: { custom: facts.customCount, game_changers: facts.gameChangers.length },
    }),
  );

  return (
    <PageContainer className="py-6 sm:py-8">
      <div className="table-sheet-controls mx-auto mb-5 flex max-w-5xl flex-wrap items-center justify-between gap-3">
        <Link
          href={`/deck/${deck.slug}`}
          className="inline-flex items-center gap-1 rounded-sm text-sm text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to the deck
        </Link>
        <div className="flex items-center gap-2">
          {isOwner && access?.stage === "beta" ? <Badge variant="gold">Beta</Badge> : null}
          {isOwner ? null : <PrintSheetButton />}
        </div>
      </div>
      <div className="mx-auto max-w-5xl">
        {isOwner ? (
          <TableSheetEditor
            deckId={deck.id}
            deckSlug={deck.slug}
            deckVisibility={deck.visibility}
            deck={sheetDeck}
            facts={facts}
            initial={sheet ?? EMPTY_TABLE_SHEET}
            qr={qr}
            shareUrl={`${base}${tableSheetPath(deck.slug)}`}
            aiAvailable={isDesignAiConfigured()}
          />
        ) : (
          <TableSheet deck={sheetDeck} facts={facts} text={sheet!} qr={qr} />
        )}
      </div>
    </PageContainer>
  );
}
