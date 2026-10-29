import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// /frames (TODO NV8) as a crawler and a reader meet it: ISR and cookie-free,
// self-canonical with the site's share images, CollectionPage + ItemList and
// BreadcrumbList JSON-LD (Home › Learn › Frames), indexed only while it has
// frames to list; each frame's tile with its example card (or its empty
// master), its verified colours and "Start with this frame"; and the link to
// /frames/requested.
// ---------------------------------------------------------------------------

vi.mock("@/lib/site-url", () => ({ getSiteBaseUrl: () => "https://www.pipglyph.com" }));

const state = vi.hoisted(() => ({
  gallery: null as null | {
    sections: import("@/lib/frames/frame-gallery").FrameGallerySection[];
    error: string | null;
    examples: Record<string, unknown>;
  },
}));
vi.mock("@/lib/frames/frame-gallery-queries", () => ({
  getFrameGallery: async () => state.gallery,
  getFrameGalleryFrames: async () => ({ sections: state.gallery!.sections, error: state.gallery!.error }),
}));

import FramesPage, { generateMetadata, revalidate } from "@/app/(marketing)/frames/page";
import { buildFrameGallery } from "@/lib/frames/frame-gallery";
import { FRAME_COLOR_KEYS } from "@/lib/creator/card-kinds";
import { SITE_OG_IMAGE, SITE_TWITTER_IMAGE } from "@/lib/seo/share-metadata";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

const OWNER = "11111111-1111-4111-8111-111111111111";
const CARD = "22222222-2222-4222-8222-222222222222";
const HOST = "https://zkwkisxoqdhdchqyjwdc.supabase.co/storage/v1/object/public/card-renders";
const ALL = new Set(FRAME_TEMPLATE_VALUES.flatMap((t) => FRAME_COLOR_KEYS.map((c) => `${t}/${c}`)));

const EXAMPLE = {
  id: CARD,
  title: "Ember Wyrm",
  path: "/card/alice/ember-wyrm",
  ownerUsername: "alice",
  cardType: "creature",
  rarity: "rare",
  colorIdentity: ["red"],
  frameStyle: { template: "m15borderless" },
  renderedImageUrl: `${HOST}/${OWNER}/${CARD}.png?v=1`,
  renderedThumbUrl: `${HOST}/${OWNER}/${CARD}.thumb.webp?v=1`,
  renderedBackThumbUrl: null,
};

beforeEach(() => {
  state.gallery = { sections: buildFrameGallery(ALL), error: null, examples: { m15borderless: EXAMPLE } };
});

const render = async () => renderToStaticMarkup(await FramesPage());
const jsonLdOf = (html: string) =>
  [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) => JSON.parse(m[1]));

describe("/frames metadata", () => {
  it("is ISR (a revalidate window), never a per-request page", () => {
    expect(typeof revalidate).toBe("number");
    const source = readFileSync(path.join(process.cwd(), "app/(marketing)/frames/page.tsx"), "utf8");
    expect(source).not.toMatch(/from "next\/headers"|createClient\(|searchParams/);
  });

  it("is self-canonical and shareable with the site's images", async () => {
    const meta = await generateMetadata();
    expect(meta.alternates?.canonical).toBe("/frames");
    expect(meta.openGraph).toMatchObject({ url: "/frames", type: "website" });
    expect(meta.openGraph?.images).toEqual([SITE_OG_IMAGE]);
    expect(meta.twitter).toMatchObject({ card: "summary_large_image" });
    expect(meta.twitter?.images).toEqual([SITE_TWITTER_IMAGE]);
    expect(meta.robots).toBeUndefined();
  });

  it("is noindex while it has nothing to list, or the list failed", async () => {
    state.gallery = { sections: [], error: null, examples: {} };
    expect((await generateMetadata()).robots).toEqual({ index: false, follow: true });
    state.gallery = { sections: [], error: "unavailable", examples: {} };
    expect((await generateMetadata()).robots).toEqual({ index: false, follow: true });
  });
});

describe("/frames page", () => {
  it("carries CollectionPage + ItemList and the Home › Learn › Frames BreadcrumbList", async () => {
    const blocks = jsonLdOf(await render());
    const collection = blocks.find((block) => block["@type"] === "CollectionPage");
    expect(collection).toMatchObject({ url: "https://www.pipglyph.com/frames", mainEntity: { "@type": "ItemList" } });
    expect(collection.mainEntity.itemListElement[0]).toMatchObject({
      name: "M15 (2015) Standard frame",
      url: "https://www.pipglyph.com/frames#frame-m15",
    });
    const crumbs = blocks.find((block) => block["@type"] === "BreadcrumbList");
    expect(crumbs.itemListElement.map((item: { name: string }) => item.name)).toEqual(["Home", "Learn", "Frames"]);
  });

  it("draws an example as a gallery tile — its 600 px thumb, linked to the card's page", async () => {
    const html = await render();
    expect(html).toContain('href="/card/alice/ember-wyrm"');
    expect(html).toContain(".thumb.webp");
    expect(html).not.toContain(`${CARD}.png`);
    expect(html).toContain("Example on the M15 (2015) Borderless frame: Ember Wyrm by @alice");
  });

  it("a frame without an example shows its empty master, never a card", async () => {
    const html = await render();
    expect(html).toContain('data-frame-placeholder="m15"');
    expect(html).not.toContain('data-frame-placeholder="m15borderless"');
    expect(html).toContain("No example yet");
  });

  it("anchors every frame and group, says its colours, and starts the creator", async () => {
    const html = await render();
    expect(html).toContain('id="frame-m15borderless"');
    expect(html).toContain('href="#frames-variations"');
    expect(html).toContain('id="frames-variations"');
    expect(html).toContain("Verified in all seven colours");
    expect(html).toMatch(/href="\/create"[^>]*>Start with this frame<span class="sr-only">: M15 \(2015\) Borderless<\/span>/);
  });

  it("links the requested frames", async () => {
    expect(await render()).toContain('href="/frames/requested"');
  });

  it("says so when the list failed, and still offers the creator", async () => {
    state.gallery = { sections: [], error: "unavailable", examples: {} };
    const html = await render();
    expect(html).toContain("The frames aren&#x27;t available right now");
    expect(html).toContain('href="/create"');
    expect(html).not.toContain("Start with this frame");
  });
});
