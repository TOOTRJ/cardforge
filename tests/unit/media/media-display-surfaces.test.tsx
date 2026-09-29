import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// The display side of migration 0127 (TODO 3.14b): a row written before it
// could point any picture column at any host, so every PUBLIC surface that
// draws one checks it with lib/media/media-urls.ts first and falls back
// (the built-in avatar / banner, no cover, no art) — an outside value is
// never drawn. The surfaces:
//
//   card art, second-face art, watermark, set icon, custom pips
//       CardPreview (every live preview) and every server render of a
//       stored card (rowToPreviewData / cardToPreviewData — the bake, the
//       sweep, PNG / PDF / share image), via lib/cards/drawable-media.ts;
//       SetSymbol itself; the pip overrides at their one query
//       (getPipOverrides); the bake refuses art it would drop
//       (resolveBakeArt); the admin moderation queue.
//   avatar / banner
//       card owner chips (gallery, trending, card lists), the card page's
//       creator block, comment authors, featured creators, the profile page
//       (banner, avatar, JSON-LD), the profile share image, the header menu
//       (/api/me and the app layout), settings and onboarding, the admin
//       user list.
//   deck cover
//       the decks grid, the deck page, My Decks, the deck share image, the
//       deck ZIP export.
//   deck entry image (Scryfall only)
//       the deck card list and the deck card modal.
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const ME = "11111111-1111-4111-8111-111111111111";
const HOST = "https://auth.pipglyph.com";
const obj = (bucket: string, name: string, owner = ME) => `${HOST}/storage/v1/object/public/${bucket}/${owner}/${name}`;
const OUTSIDE = "https://tracker.example/pixel.png";

beforeEach(() => vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", HOST));

describe("CardPreview draws only our pictures", () => {
  it("an outside art, set icon and watermark are not drawn; ours are", async () => {
    const { CardPreview } = await import("@/components/cards/card-preview");
    const outside = renderToStaticMarkup(
      <CardPreview
        title="Probe"
        cardType="creature"
        colorIdentity={["white"]}
        rarity="rare"
        frameStyle={{ template: "m15" }}
        artUrl={OUTSIDE}
        setIconUrl={`${OUTSIDE}?icon`}
        watermark={{ kind: "custom", url: `${OUTSIDE}?wm` }}
      />,
    );
    expect(outside).not.toContain("tracker.example");

    const ours = renderToStaticMarkup(
      <CardPreview
        title="Probe"
        cardType="creature"
        colorIdentity={["white"]}
        rarity="rare"
        frameStyle={{ template: "m15" }}
        artUrl={obj("card-art", "art.png")}
        setIconUrl={obj("set-covers", "icon.png")}
        watermark={{ kind: "custom", url: obj("card-art", "wm-1.png") }}
      />,
    );
    for (const url of [obj("card-art", "art.png"), obj("set-covers", "icon.png")]) expect(ours).toContain(url);
  });

  it("SetSymbol on its own falls back to the mark for an outside icon", async () => {
    const { SetSymbol } = await import("@/components/cards/set-symbol");
    expect(renderToStaticMarkup(<SetSymbol rarity="rare" iconUrl={OUTSIDE} />)).not.toContain("tracker.example");
    expect(renderToStaticMarkup(<SetSymbol rarity="rare" iconUrl={obj("set-covers", "i.png")} />)).toContain(
      obj("set-covers", "i.png"),
    );
  });
});

describe("every server render of a stored card drops the same pictures", () => {
  it("rowToPreviewData (the bake, the sweep, PNG / PDF / share image) and cardToPreviewData", async () => {
    vi.doMock("server-only", () => ({}));
    const { rowToPreviewData } = await import("@/lib/cards/bake-core");
    const { cardToPreviewData } = await import("@/lib/cards/preview-data");
    const row = {
      id: "c",
      owner_id: ME,
      visibility: "public",
      updated_at: "",
      title: "T",
      cost: null,
      card_type: "creature",
      supertype: null,
      subtypes: [],
      rarity: "rare",
      color_identity: ["white"],
      rules_text: null,
      flavor_text: null,
      power: null,
      toughness: null,
      loyalty: null,
      defense: null,
      artist_credit: null,
      art_url: OUTSIDE,
      art_position: {},
      frame_style: { template: "m15" },
      set_icon_url: OUTSIDE,
      set_icon_code: null,
      back_face: { title: "B", art_url: OUTSIDE },
      face_content: null,
      watermark: { kind: "custom", url: OUTSIDE },
    };
    for (const data of [
      rowToPreviewData(row as never, { W: OUTSIDE }),
      cardToPreviewData(row as never),
    ]) {
      expect(data.artUrl).toBeNull();
      expect(data.setIconUrl).toBeNull();
      expect(data.watermark).toBeNull();
      expect(data.backFace?.art_url).toBeUndefined();
      expect(JSON.stringify(data)).not.toContain("tracker.example");
    }
    const ours = rowToPreviewData({ ...row, art_url: obj("card-art", "a.png") } as never);
    expect(ours.artUrl).toBe(obj("card-art", "a.png"));
  });
});

describe("the pip overrides keep only the owner's own stored pips", () => {
  it("getPipOverrides", async () => {
    vi.doMock("server-only", () => ({}));
    vi.doMock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        from: () => ({
          select: () => ({
            eq: async () => ({
              data: [
                { symbol: "W", image_url: `${obj("custom-pips", "W.png")}?v=1` },
                { symbol: "U", image_url: OUTSIDE },
                { symbol: "B", image_url: obj("custom-pips", "B.png", "99999999-9999-4999-8999-999999999999") },
                { symbol: "R", image_url: obj("card-art", "R.png") },
              ],
              error: null,
            }),
          }),
        }),
      }),
    }));
    const { getPipOverrides } = await import("@/lib/pips/queries");
    expect(await getPipOverrides(ME)).toEqual({ W: `${obj("custom-pips", "W.png")}?v=1` });
  });
});

// Each surface draws through the guard — pinned at the source so a
// refactor that goes back to the raw column fails here.
describe("the surfaces that draw a picture column", () => {
  const SURFACES: [string, RegExp][] = [
    ["components/cards/card-preview.tsx", /drawableCardMedia\(rawProps\)/],
    ["components/cards/set-symbol.tsx", /drawableMediaUrl\("set-icon", iconUrl\)/],
    ["lib/cards/bake-core.ts", /return drawableCardMedia\(\{/],
    ["lib/cards/preview-data.ts", /return drawableCardMedia\(\{/],
    ["lib/cards/bake-render.ts", /if \(!isAllowedMediaUrl\("card-art", artUrl\)\)/],
    ["lib/pips/queries.ts", /isAllowedMediaUrl\("pip", row\.image_url, ownerId\)/],
    ["lib/moderation/queries.ts", /artUrl: drawableMediaUrl\("card-art", card\.art_url\)/],
    ["lib/cards/queries.ts", /avatar_url: profileMediaSrc\("avatar", row\.avatar_url, row\.id\)/],
    ["lib/cards/comments-queries.ts", /avatar_url: profileMediaSrc\("avatar", p\.avatar_url, p\.id\)/],
    ["components/cards/card-detail-content.tsx", /profileMediaSrc\("avatar", profile\.avatar_url, profile\.id\)/],
    ["lib/featured/queries.ts", /bannerUrl: profileMediaSrc\("banner", p\.banner_url, p\.id\)/],
    ["app/(marketing)/profile/[username]/page.tsx", /bannerUrl=\{profileMediaSrc\("banner", profile\.banner_url, profile\.id\)\}/],
    ["app/(marketing)/profile/[username]/opengraph-image.tsx", /profileMediaSrc\("avatar", profile\.avatar_url, profile\.id\)/],
    ["app/api/me/route.ts", /avatarUrl: profileMediaSrc\("avatar", profile\?\.avatar_url, user\.id\)/],
    ["app/(app)/layout.tsx", /avatarUrl: profileMediaSrc\("avatar", profile\?\.avatar_url, user\.id\)/],
    ["app/(app)/settings/page.tsx", /drawableMediaUrl\("banner", profile\?\.banner_url, profile\?\.id\)/],
    ["app/(onboarding)/onboarding/page.tsx", /drawableMediaUrl\("avatar", profile\.avatar_url, profile\.id\)/],
    ["lib/admin/users-queries.ts", /avatarUrl: profileMediaSrc\("avatar", row\.avatar_url, row\.id\)/],
    ["app/(marketing)/decks/decks-view.tsx", /drawableMediaUrl\("deck-cover", deck\.cover_url, deck\.owner_id\)/],
    ["app/(marketing)/deck/[slug]/page.tsx", /drawableMediaUrl\("deck-cover", deck\.cover_url, deck\.owner_id\)/],
    ["app/(app)/dashboard/decks/page.tsx", /drawableMediaUrl\("deck-cover", deck\.cover_url, deck\.owner_id\)/],
    ["app/(marketing)/deck/[slug]/opengraph-image.tsx", /drawableMediaUrl\("deck-cover", deck\.cover_url, deck\.owner_id\)/],
    ["app/api/decks/[id]/download/route.ts", /drawableMediaUrl\("deck-cover", deck\.cover_url, deck\.owner_id\)/],
    ["components/decks/deck-card-list.tsx", /drawableMediaUrl\("deck-card-image", entry\.image_url\)/],
    ["components/decks/deck-card-modal.tsx", /drawableMediaUrl\("deck-card-image", entry\.image_url\)/],
  ];

  it.each(SURFACES)("%s", (file, guard) => {
    expect(read(file)).toMatch(guard);
  });

  it("no public surface draws a picture column raw", () => {
    const RAW = /src=\{[^}]*\b(avatar_url|banner_url|cover_url|art_url|image_url|set_icon_url)\b[^}]*\}/;
    // Drawn raw on purpose, with the reason.
    const ALLOWED = new Set([
      // The creator's own second-face upload, before it is saved.
      "components/creator/panels/art-panel.tsx",
      // A decklist line's live Scryfall lookup (not a stored value).
      "components/decks/import-decklist-dialog.tsx",
      // Owner / author avatars already sanitised by their queries
      // (lib/cards/queries.ts, lib/cards/comments-queries.ts, above).
      "components/gallery/trending-cards-section.tsx",
      "components/cards/card-comments.tsx",
    ]);
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(rel);
        else if (/\.tsx$/.test(entry.name) && RAW.test(read(rel)) && !ALLOWED.has(rel)) offenders.push(rel);
      }
    };
    walk("app");
    walk("components");
    expect(offenders).toEqual([]);
  });
});
