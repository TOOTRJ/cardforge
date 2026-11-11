import Link from "next/link";
import { ArrowLeft, ArrowRight, EyeOff } from "lucide-react";
import { CardTile } from "@/components/cards/card-tile";
import { CARD_GRID_SIZES, CardGrid } from "@/components/cards/card-grid";
import { Button } from "@/components/ui/button";
import { getFrameProfileOverrides } from "@/lib/cards/frame-profile-overrides";
import { cardToPreviewData } from "@/lib/cards/preview-data";
import { buildCardPath } from "@/lib/cards/utils";
import { formatUtcDate } from "@/lib/format/dates";
import {
  ADMIN_UNLISTED_PARAM,
  listUnlistedCardsForAdmin,
  type AdminUnlistedCards,
} from "@/lib/admin/unlisted-cards";
import type { FrameProfileOverridesMap } from "@/lib/cards/profile-override";
import type { Card } from "@/types/card";

// ---------------------------------------------------------------------------
// The profile page's "Unlisted cards" section — ADMINS ONLY, for debugging
// (owner 2026-11-11: a creator asked for a frame fix on a card they had saved
// unlisted, and the team had no way to find it).
//
// It renders NOTHING for anyone else: the reader answers null unless the
// viewer is an admin (lib/admin/unlisted-cards.ts — the gate is there, not
// here), and a null answer is no section at all, not an empty one. Private
// cards are never listed. Each tile opens the card's own page, which an
// unlisted card already serves to anyone holding its link.
// ---------------------------------------------------------------------------

const SECTION_ID = "unlisted-cards";

/** The profile address that shows `page` of the section. */
export function unlistedCardsHref(username: string, page: number): string {
  const query = page > 1 ? `?${ADMIN_UNLISTED_PARAM}=${page}` : "";
  return `/profile/${encodeURIComponent(username)}${query}#${SECTION_ID}`;
}

export async function ProfileUnlistedCards({
  ownerId,
  ownerUsername,
  displayName,
  page,
}: {
  ownerId: string;
  ownerUsername: string;
  displayName: string;
  page: number;
}) {
  const result = await listUnlistedCardsForAdmin(ownerId, page);
  if (!result) return null;
  const profileOverrides = result.ok && result.cards.length > 0 ? await getFrameProfileOverrides() : null;
  return (
    <ProfileUnlistedCardsView
      result={result}
      ownerUsername={ownerUsername}
      displayName={displayName}
      profileOverrides={profileOverrides}
    />
  );
}

/** The section as drawn — the answer is the caller's (an admin's, always). */
export function ProfileUnlistedCardsView({
  result,
  ownerUsername,
  displayName,
  profileOverrides = null,
}: {
  result: AdminUnlistedCards;
  ownerUsername: string;
  displayName: string;
  profileOverrides?: FrameProfileOverridesMap | null;
}) {
  const total = result.ok ? result.total : null;
  return (
    <section
      id={SECTION_ID}
      aria-labelledby="unlisted-cards-heading"
      className="mt-14 scroll-mt-24 rounded-xl border border-dashed border-gold/40 bg-gold/5 p-4 sm:p-6"
      data-testid="profile-unlisted-cards"
    >
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 border-b border-gold/20 pb-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-gold-strong">
            <EyeOff className="h-3.5 w-3.5" aria-hidden />
            Admin only
          </span>
          <h2
            id="unlisted-cards-heading"
            className="font-display text-2xl font-semibold tracking-tight text-foreground [overflow-wrap:anywhere] sm:text-3xl"
          >
            Unlisted cards
          </h2>
        </div>
        {total !== null ? (
          <span className="text-sm text-muted">
            {total.toLocaleString("en-US")} unlisted {total === 1 ? "card" : "cards"}
          </span>
        ) : null}
      </div>
      <p className="mt-3 max-w-[38rem] text-sm leading-6 text-muted">
        Only admins see this section, and only for debugging. Unlisted cards open for anyone with their link but are in
        no gallery, search or profile list; nobody else sees them here. Private cards are never shown.
      </p>

      <div className="mt-5">
        {!result.ok ? (
          <p role="status" className="text-sm text-danger">
            Couldn’t load the unlisted cards. Reload the page to try again.
          </p>
        ) : result.cards.length === 0 ? (
          result.page > 1 ? (
            <div className="flex flex-wrap items-center gap-3">
              <p role="status" className="text-sm text-muted">
                This page is past the last unlisted card.
              </p>
              <Button asChild variant="outline" size="sm">
                <Link href={unlistedCardsHref(ownerUsername, 1)} scroll={false}>
                  Back to the first page
                </Link>
              </Button>
            </div>
          ) : (
            <p role="status" className="text-sm text-muted">
              {displayName} has no unlisted cards.
            </p>
          )
        ) : (
          <>
            <p className="mb-4 text-sm text-muted">
              Showing {(result.page - 1) * result.pageSize + 1}–{(result.page - 1) * result.pageSize + result.cards.length}{" "}
              of {result.total.toLocaleString("en-US")}, most recently edited first.
            </p>
            <CardGrid>
              {result.cards.map((card) => (
                <UnlistedCardTile
                  key={card.id}
                  card={card}
                  ownerUsername={ownerUsername}
                  profileOverrides={profileOverrides}
                />
              ))}
            </CardGrid>
            <UnlistedPager result={result} ownerUsername={ownerUsername} />
          </>
        )}
      </div>
    </section>
  );
}

function UnlistedPager({
  result,
  ownerUsername,
}: {
  result: Extract<AdminUnlistedCards, { ok: true }>;
  ownerUsername: string;
}) {
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  if (pages <= 1) return null;
  return (
    <nav
      aria-label="Unlisted card pages"
      className="mt-8 flex items-center justify-between gap-3 border-t border-gold/20 pt-5"
    >
      <span className="text-xs text-subtle">
        Page {result.page} of {pages}
      </span>
      <div className="flex items-center gap-2">
        {result.page > 1 ? (
          <Button asChild variant="outline" size="sm">
            <Link href={unlistedCardsHref(ownerUsername, result.page - 1)} rel="prev" scroll={false}>
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
              Previous
            </Link>
          </Button>
        ) : null}
        {result.page < pages ? (
          <Button asChild variant="outline" size="sm">
            <Link href={unlistedCardsHref(ownerUsername, result.page + 1)} rel="next" scroll={false}>
              Next
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </Button>
        ) : null}
      </div>
    </nav>
  );
}

/** What a frame report needs beside the picture: the frame the card is
 *  stored on, the layout it was last baked at, and when it last changed. */
function UnlistedCardTile({
  card,
  ownerUsername,
  profileOverrides,
}: {
  card: Card;
  ownerUsername: string;
  profileOverrides: FrameProfileOverridesMap | null;
}) {
  const template = (card.frame_style as { template?: unknown } | null)?.template;
  const frame = typeof template === "string" && template ? template : "no frame";
  const layout = typeof card.layout_version === "number" ? `layout v${card.layout_version}` : "not baked";
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <CardTile
        body={(slot) => (
          <Link
            href={buildCardPath({ slug: card.slug, owner: { username: ownerUsername } })}
            aria-label={`Open ${card.title} (unlisted)`}
            {...slot}
          />
        )}
        thumbnail={{
          renderedImageUrl: card.rendered_image_url,
          renderedThumbUrl: card.rendered_thumb_url,
          renderedBackThumbUrl: card.rendered_back_thumb_url,
          title: card.title,
          previewData: cardToPreviewData(card, profileOverrides),
          sizes: CARD_GRID_SIZES,
        }}
      />
      <div className="flex min-w-0 flex-col gap-0.5 text-xs">
        <span className="truncate text-foreground">{card.title}</span>
        <span className="truncate font-mono text-[11px] text-muted">
          {frame} · {layout}
        </span>
        <span className="truncate text-subtle">Edited {formatUtcDate(card.updated_at)}</span>
      </div>
    </div>
  );
}
