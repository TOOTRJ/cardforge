import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// An image a SERVER component draws is lazy — or it is drawn from the client
// leaf `EagerImage` (components/ui/eager-image.tsx).
//
// React (19.2) writes a preload hint into a page's RSC payload for every
// server-rendered <img> that is not `loading="lazy"`, and that payload is
// what a <Link> prefetch fetches. So the home page's six first-row
// thumbnails, eager and high priority, were preloaded by EVERY page that
// links to "/" — 431 KB on /pricing that the page never showed, and Chrome's
// "preloaded using link preload but not used" once per image (production,
// 2026-11-11). Lazy images write no hint; a client leaf's image is not part
// of the server render at all.
// ---------------------------------------------------------------------------

const files: string[] = [];
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (name.endsWith(".tsx")) files.push(path);
  }
};
walk("app");
walk("components");
const read = (path: string) => readFileSync(path, "utf8");
const isClient = (path: string) => /^\s*["']use client["']/.test(read(path));

/** Every `<img … />` a file DRAWS: an element that opens its own line (a
 *  comment that mentions the tag does not). */
const imagesOf = (path: string) => read(path).match(/^[ \t]*<img\b[\s\S]*?\/>/gm) ?? [];

// Eager on purpose, and why none of them rides a prefetch to another page.
const EAGER_ON_PURPOSE: Record<string, string> = {
  // The signed-in viewer's own avatar, on pages that are rendered per request
  // (a prefetch of a dynamic page stops at its loading boundary).
  "app/(app)/dashboard/page.tsx": "the viewer's avatar on a per-request page",
  "app/(app)/admin/users/page.tsx": "a user's avatar on a per-request admin page",
  // Parts of the card's own drawing (the live preview): they load with the
  // card, and the renderer is not this rule's to change.
  "components/cards/set-symbol.tsx": "the set symbol inside the card preview",
  "components/cards/mana-cost-glyphs.tsx": "an owner's own pip inside the card preview",
};

/** Files that draw an IMAGE FILE (Satori), not a page: no HTML, no hint. */
const isImageRoute = (path: string) => /(opengraph-image|twitter-image|icon|apple-icon)\.tsx$/.test(path);

describe("a server component's image is lazy, or drawn from the client leaf", () => {
  const serverFiles = files.filter((path) => !isClient(path) && !isImageRoute(path));

  it("finds the server files that draw images (the scan is not empty)", () => {
    expect(serverFiles.filter((path) => imagesOf(path).length > 0).length).toBeGreaterThanOrEqual(5);
  });

  it("no server-rendered <img> is eager, or eager by a condition, outside the named few", () => {
    const eager: string[] = [];
    for (const path of serverFiles) {
      for (const image of imagesOf(path)) {
        if (/\bloading="lazy"/.test(image)) continue;
        eager.push(path);
      }
    }
    expect([...new Set(eager)].sort()).toEqual(Object.keys(EAGER_ON_PURPOSE).sort());
  });

  it("the client leaf is a client component that draws the <img> it is given", () => {
    expect(isClient("components/ui/eager-image.tsx")).toBe(true);
    expect(read("components/ui/eager-image.tsx")).toContain("return <img alt={alt} {...rest} />;");
  });

  it("the first-row thumbnail — eager, high priority — is the client leaf's; every other thumbnail is lazy", () => {
    const thumb = read("components/cards/baked-card-thumbnail.tsx");
    const leaf = /<EagerImage\b[\s\S]*?\/>/.exec(thumb)?.[0] ?? "";
    expect(leaf).toContain('loading="eager"');
    expect(leaf).toContain('fetchPriority="high"');
    expect(thumb.slice(0, thumb.indexOf("<EagerImage"))).toMatch(/priority \? \(\s*(\/\/[^\n]*\n\s*)*$/);
    const plain = imagesOf("components/cards/baked-card-thumbnail.tsx");
    expect(plain.length).toBeGreaterThan(0);
    for (const image of plain) expect(image).toContain('loading="lazy"');
  });

  it("an article's cover — its largest picture — is the client leaf's: a list of articles preloads none of them", () => {
    const view = read("components/content/article-view.tsx");
    expect(/<EagerImage\b[\s\S]*?\/>/.exec(view)?.[0]).toContain('fetchPriority="high"');
    expect(imagesOf("components/content/article-view.tsx")).toEqual([]);
  });

  it("the deck hero's front printing is the client leaf's too", () => {
    const fan = read("components/decks/deck-card-fan.tsx");
    expect(/<EagerImage\b[\s\S]*?\/>/.exec(fan)?.[0]).toContain('loading="eager"');
    for (const image of imagesOf("components/decks/deck-card-fan.tsx")) expect(image).toContain('loading="lazy"');
  });
});
