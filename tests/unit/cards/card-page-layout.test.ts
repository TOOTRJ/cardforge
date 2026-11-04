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

  it("uses the wide frame's width as columns, never longer lines (TODO WD10, CP2b)", () => {
    // Three columns from xl — the card, the text at a reading measure, the
    // rail — spread over the wide frame at 2xl.
    const grid = readFileSync(join(process.cwd(), "components/cards/card-page-grid.ts"), "utf8");
    expect(grid).toContain("xl:grid-cols-[minmax(0,23rem)_minmax(0,1fr)_minmax(0,20rem)]");
    expect(grid).toContain("2xl:grid-cols-[minmax(0,30rem)_minmax(0,44rem)_minmax(0,21rem)]");
    // The rows below the card are the card grid's one-row strips.
    expect(page).toMatch(/<div className=\{ROW_GRID_CLASS\}>[\s\S]{0,300}rowTileClass\(index\)/);
    expect(page).toContain("listMoreFromOwner(card.owner_id, card.id, ROW_MAX)");
  });

  it("draws its loading skeleton in the page's own grid areas, so nothing shifts", () => {
    const skeleton = readFileSync(join(process.cwd(), "components/cards/card-detail-skeleton.tsx"), "utf8");
    for (const source of [page, skeleton]) {
      expect(source).toContain("<div className={CARD_PAGE_GRID}>");
      for (const area of ["head", "hero", "actions", "text", "rail"]) expect(source).toContain(`AREA.${area})`);
    }
  });

  it("pins the phone's action bar to the bottom of the screen, its buttons scrolling inside it", () => {
    const grid = readFileSync(join(process.cwd(), "components/cards/card-page-grid.ts"), "utf8");
    expect(grid).toMatch(/actions: cn\([\s\S]*max-md:sticky max-md:bottom-0/);
    expect(page).toContain("max-md:overflow-x-auto");
  });

  it("keeps the text details, the JSON-LD and the breadcrumbs for every viewer", () => {
    expect(page).toContain("<CardDetails card={card} aiProvenance={aiProvenance} pipOverrides={pipOverrides} />");
    expect(page).toMatch(/const jsonLd =\s*isShareable\s*\? buildCardJsonLd\(/);
    expect(page).toContain("breadcrumbJsonLd([");
    expect(page).toContain('<nav aria-label="Breadcrumb"');
    // The type's hub between the gallery and the card, in both.
    expect(page).toContain("{ name: TYPE_HUB_CRUMBS[typeHub], path: `/gallery/type/${typeHub}` }");
  });

  it("orders the page: title, card, actions, details, then the rail (creator, numbers)", () => {
    const order = ["<h1", "<CardHeroPreview", "<DownloadModal", "<LikeButton", "<CardDetails card", "<CreatorFeature", "<CardStats"].map((s) =>
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
