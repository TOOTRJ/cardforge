import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// TODO 3.26 — the display surfaces that cut a card's corner all use the ONE
// card corner (app/globals.css .card-corners / .card-corners-landscape, the
// CSS twin of lib/cards/card-corner.ts), never a fixed or ad-hoc radius. A
// percentage radius is circular only on an exact 5:7 / 7:5 box, so every
// surface here is the card box itself (tile, focus ring, scrim, overlay).
// The DOM-level checks live in tests/unit/components/baked-card-thumbnail
// and render-update-compare; this pins the sources those can't render cheaply.
// ---------------------------------------------------------------------------

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
/** The source of one top-level function, up to the next top-level one. */
const fn = (src: string, name: string) => {
  const start = src.indexOf(`function ${name}(`);
  expect(start, name).toBeGreaterThanOrEqual(0);
  const next = src.indexOf("\nfunction ", start + 1);
  const nextExport = src.indexOf("\nexport ", start + 1);
  const ends = [next, nextExport].filter((i) => i > 0);
  return src.slice(start, ends.length ? Math.min(...ends) : undefined);
};

describe("card-corner display surfaces", () => {
  it("the creator's generating overlay follows the preview's orientation", () => {
    const form = read("components/creator/card-creator-form.tsx");
    const overlay = fn(form, "CardGeneratingOverlay");
    expect(overlay).toContain("${cardCornersClass(landscape)}");
    expect(overlay).not.toContain("rounded-[5%]");
    expect(form).toContain("const previewLandscape = isLandscapeFrame(watched.frame_style);");
    expect(form.match(/landscape=\{previewLandscape\}/g)).toHaveLength(2);
  });

  it("the admin frame-compare scan is clipped at the card corner (its box is always the 5:7 scan)", () => {
    const scan = fn(read("components/admin/frame-compare.tsx"), "ScanImage");
    expect(scan).toContain('className="pointer-events-none absolute z-10 card-corners"');
    expect(scan).not.toContain("rounded-[4.5%]");
  });

  it("tile focus rings, the dashboard selection ring and its hover scrim are the tile's corner", () => {
    for (const file of [
      "components/cards/gallery-card-tile.tsx",
      "components/creator/liked-card-tile.tsx",
      "components/gallery/trending-cards-section.tsx",
      "components/creator/dashboard-card-tile.tsx",
    ]) {
      const src = read(file);
      expect(src, file).not.toContain("rounded-frame");
      expect(src, file).toMatch(/card-corners/);
    }
    const profileTile = fn(read("app/(marketing)/profile/[username]/page.tsx"), "ProfileCardTile");
    expect(profileTile).toContain('className="block card-corners focus-visible');
    expect(read("components/creator/dashboard-card-tile.tsx").match(/card-corners/g)).toHaveLength(3);
  });

  it("skeletons, the deck card modal, moderation and the marketing strips use the corner", () => {
    expect(read("components/cards/card-detail-skeleton.tsx")).toContain(
      '"skeleton aspect-[5/7] w-full card-corners"',
    );
    const deckModal = read("components/decks/deck-card-modal.tsx");
    expect(deckModal).toContain("relative block aspect-[5/7] w-full overflow-hidden card-corners border");
    expect(deckModal).toContain('"aspect-[5/7] w-full card-corners bg-[#101015] object-cover"');
    expect(read("app/(app)/admin/moderation/page.tsx")).toContain(
      "aspect-[5/7] w-28 shrink-0 overflow-hidden card-corners",
    );
    // A 7:5 render (Battle, Split) is shown whole in its own landscape box,
    // never cropped to its middle by the 5:7 slot.
    expect(read("app/(app)/admin/moderation/page.tsx")).toContain(
      '<div className="aspect-[7/5] w-full overflow-hidden card-corners-landscape">',
    );
    expect(read("lib/moderation/queries.ts")).toContain("landscape: isLandscapeFrame(card.frame_style),");
    expect(deckModal).toContain("isLandscapeFrame(card?.frame_style)");
    expect(deckModal).toContain('<span className="block aspect-[7/5] w-full overflow-hidden card-corners-landscape">');
    // An <img> whose box is the card itself, 5:7 or 7:5 by the render.
    expect(read("components/marketing/featured-creators.tsx")).toContain(
      "${cardCornersClass(card.landscape)}",
    );
    expect(read("components/marketing/marketing-hero.tsx")).toContain(
      "${cardCornersClass(card.landscape ?? false)}",
    );
  });
});
