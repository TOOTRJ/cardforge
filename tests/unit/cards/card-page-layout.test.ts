import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatStatCount } from "@/components/cards/card-detail-content";

// The card page's layout (2026-10-30 refactor): what the page must keep,
// read from its source so a later edit can't drop it unnoticed.

const page = readFileSync(join(process.cwd(), "components/cards/card-detail-content.tsx"), "utf8");

describe("the card page's layout", () => {
  it("is framed by PageContainer (wide, TODO WD10), its loading state too", () => {
    expect(page).toMatch(/<PageContainer size="wide" className="py-6 sm:py-10">/);
    const loading = readFileSync(join(process.cwd(), "app/(marketing)/card/[username]/[slug]/loading.tsx"), "utf8");
    expect(loading).toMatch(/<PageContainer size="wide" className="py-6 sm:py-10">/);
  });

  it("uses the wide frame's width as columns, never longer lines (TODO WD10)", () => {
    // The details keep their 42rem measure; the creator's panel joins them
    // as a column of its own from 2xl.
    expect(page).toContain("2xl:grid-cols-[minmax(0,42rem)_20rem]");
    // The rows below the card are the card grid's one-row strips.
    expect(page).toMatch(/<div className=\{ROW_GRID_CLASS\}>[\s\S]{0,300}rowTileClass\(index\)/);
    expect(page).toContain("listMoreFromOwner(card.owner_id, card.id, ROW_MAX)");
  });

  it("draws its loading skeleton in the same columns, so nothing shifts at 2xl", () => {
    const skeleton = readFileSync(join(process.cwd(), "components/cards/card-detail-skeleton.tsx"), "utf8");
    const infoColumn =
      "flex min-w-0 max-w-2xl flex-col gap-6 2xl:grid 2xl:max-w-none 2xl:grid-cols-[minmax(0,42rem)_20rem] 2xl:items-start 2xl:gap-x-12";
    expect(page).toContain(`className="${infoColumn}"`);
    expect(skeleton).toContain(`className="${infoColumn}"`);
    // The creator's panel: its own sticky column from 2xl in both.
    expect(page).toContain('className="min-w-0 2xl:sticky 2xl:top-24"');
    expect(skeleton).toContain('className="min-w-0 2xl:sticky 2xl:top-24"');
  });

  it("keeps the text details, the JSON-LD and the breadcrumbs for every viewer", () => {
    expect(page).toContain("<CardDetails card={card} inDecks={inDecks} aiProvenance={aiProvenance} />");
    expect(page).toMatch(/const jsonLd =\s*isShareable\s*\? buildCardJsonLd\(/);
    expect(page).toContain("breadcrumbJsonLd([");
    expect(page).toContain('<nav aria-label="Breadcrumb"');
  });

  it("orders the info column: title, actions, stats, details, creator", () => {
    const order = ["<h1", "<DownloadModal", "<LikeButton", "<CardStats", "<CardDetails card", "<CreatorFeature"].map((s) =>
      page.indexOf(s),
    );
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("puts the comments last, at the anchor the stats link to", () => {
    expect(page).toContain('<div id="comments" className="max-w-3xl scroll-mt-24">');
    expect(page).toContain('href: "#comments"');
    expect(page.indexOf("<CardComments")).toBeGreaterThan(page.indexOf('title="More like this"'));
  });

  it("keeps the moderation lock's pieces (0156) for the owner", () => {
    expect(page).toContain('from "@/lib/moderation/lock"');
    expect(page).toContain("isOwner ? ownerVisibilityLabel(card) : VISIBILITY_LABELS[card.visibility]");
    expect(page).toMatch(/isOwner && isModerationLocked\(card\) \?[\s\S]{0,300}\{MODERATION_LOCK_NOTE\}/);
    expect(page).toContain("href={MODERATION_CONTACT_HREF}");
    expect(page).toMatch(
      /<RemixButton[\s\S]{0,400}unavailableReason=\{isModerationLocked\(card\) \? MODERATION_LOCKED_REMIX_MESSAGE : undefined\}/,
    );
  });

  it("names each stats link by its label, not the bare number", () => {
    expect(page).toContain('<span className="sr-only"> {s.label}</span>');
  });
});

describe("formatStatCount", () => {
  it("writes counts up to 9,999 in full and compacts past it", () => {
    expect(formatStatCount(0)).toBe("0");
    expect(formatStatCount(420)).toBe("420");
    expect(formatStatCount(9_999)).toBe("9,999");
    expect(formatStatCount(12_345)).toBe("12.3K");
    expect(formatStatCount(1_200_000)).toBe("1.2M");
  });
});
