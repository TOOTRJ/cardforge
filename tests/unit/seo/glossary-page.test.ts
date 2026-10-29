import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// /glossary (TODO NV9): static, self-canonical, shareable (the site's share
// images kept — lib/seo/share-metadata.ts), every entry on the page with its
// own anchor, and a DefinedTermSet + BreadcrumbList that say exactly what
// the page shows.
// ---------------------------------------------------------------------------

vi.mock("@/lib/site-url", () => ({ getSiteBaseUrl: () => "https://www.pipglyph.com" }));

import GlossaryPage, { dynamic, metadata } from "@/app/(marketing)/glossary/page";
import { GLOSSARY_TERMS } from "@/lib/content/glossary";
import { SITE_OG_IMAGE, SITE_TWITTER_IMAGE } from "@/lib/seo/share-metadata";

const BASE = "https://www.pipglyph.com";

/** Every JSON-LD block in the markup, parsed. */
function jsonLdBlocks(html: string): Array<Record<string, unknown>> {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
    (m) => JSON.parse(m[1]) as Record<string, unknown>,
  );
}

/** The page's text as a reader sees it (React escapes ' and "). */
const unescape = (html: string) =>
  html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

describe("/glossary", () => {
  it("is static, self-canonical and keeps the share images", () => {
    expect(dynamic).toBe("error");
    expect(metadata.alternates?.canonical).toBe("/glossary");
    expect(metadata.openGraph).toMatchObject({ url: "/glossary", images: [SITE_OG_IMAGE] });
    expect(metadata.twitter).toMatchObject({
      card: "summary_large_image",
      images: [SITE_TWITTER_IMAGE],
    });
    expect(metadata.robots).toBeUndefined();
  });

  it("renders every entry with its anchor, name and definition", () => {
    const html = renderToStaticMarkup(GlossaryPage());
    const text = unescape(html);
    for (const entry of GLOSSARY_TERMS) {
      expect(html, entry.id).toContain(`id="${entry.id}"`);
      expect(text, entry.id).toContain(entry.term);
      expect(text, entry.id).toContain(entry.definition);
    }
    // One H1, letters as the sections' headings, the A–Z jump list.
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('id="letter-p"');
    expect(html).toContain('href="#letter-p"');
    expect(html).toContain('aria-label="Glossary, A to Z"');
    expect(html).toMatch(/<label[^>]*for="glossary-filter"/);
  });

  it("says the same words in its DefinedTermSet, one DefinedTerm per anchor", () => {
    const blocks = jsonLdBlocks(renderToStaticMarkup(GlossaryPage()));
    const set = blocks.find((b) => b["@type"] === "DefinedTermSet")!;
    expect(set).toMatchObject({ url: `${BASE}/glossary`, "@id": `${BASE}/glossary` });
    const terms = set.hasDefinedTerm as Array<Record<string, unknown>>;
    expect(terms).toHaveLength(GLOSSARY_TERMS.length);
    GLOSSARY_TERMS.forEach((entry, index) => {
      expect(terms[index]).toMatchObject({
        "@type": "DefinedTerm",
        name: entry.term,
        description: entry.definition,
        url: `${BASE}/glossary#${entry.id}`,
        inDefinedTermSet: { "@id": `${BASE}/glossary` },
      });
      if (entry.aliases) expect(terms[index].alternateName).toEqual(entry.aliases);
      else expect(terms[index]).not.toHaveProperty("alternateName");
    });
  });

  it("sits under Learn in its breadcrumb trail", () => {
    const blocks = jsonLdBlocks(renderToStaticMarkup(GlossaryPage()));
    const crumbs = blocks.find((b) => b["@type"] === "BreadcrumbList")!;
    expect(
      (crumbs.itemListElement as Array<{ name: string; item: string }>).map((c) => [c.name, c.item]),
    ).toEqual([
      ["Home", `${BASE}/`],
      ["Learn", `${BASE}/learn`],
      ["Glossary", `${BASE}/glossary`],
    ]);
  });
});
