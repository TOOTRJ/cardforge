import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// The help centre's SEO contract (TODO NV6): the eight sections are the only
// /help/<section> pages — anything else is a real 404 (notFound() in the
// metadata AND the page) — each is self-canonical with OG + Twitter tags
// that keep the site's share images, and carries a BreadcrumbList
// (Home › Help › Section) and a FAQPage of exactly the answers whose home it
// is. The hub links every section and marks up no answer at all.
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  },
}));
vi.mock("@/lib/site-url", () => ({ getSiteBaseUrl: () => "https://www.pipglyph.com" }));

import HelpSectionPage, {
  generateMetadata,
  generateStaticParams,
} from "@/app/(marketing)/help/[section]/page";
import HelpPage, { metadata as hubMetadata } from "@/app/(marketing)/help/page";
import { faqEntryById, HELP_SECTION_SLUGS, getHelpSection, helpSectionMarkupEntries } from "@/lib/content/help";
import { SITE_OG_IMAGE, SITE_TWITTER_IMAGE } from "@/lib/seo/share-metadata";

const paramsOf = (section: string) => ({ params: Promise.resolve({ section }) });

/** Every JSON-LD block of a rendered page, parsed. */
function jsonLdOf(html: string): Array<Record<string, unknown>> {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
    (match) => JSON.parse(match[1]) as Record<string, unknown>,
  );
}

describe("/help/[section]", () => {
  it("builds exactly the eight sections", () => {
    expect(generateStaticParams()).toEqual(HELP_SECTION_SLUGS.map((section) => ({ section })));
    expect(HELP_SECTION_SLUGS).toHaveLength(8);
  });

  it.each(HELP_SECTION_SLUGS)("%s is self-canonical, indexed and shareable", async (slug) => {
    const meta = await generateMetadata(paramsOf(slug));
    expect(meta.alternates?.canonical).toBe(`/help/${slug}`);
    expect(meta.robots).toBeUndefined();
    expect(meta.description).toBe(getHelpSection(slug)!.description);
    expect(meta.openGraph).toMatchObject({ url: `/help/${slug}`, type: "website" });
    expect(meta.twitter).toMatchObject({ card: "summary_large_image" });
    expect(meta.openGraph?.images).toEqual([SITE_OG_IMAGE]);
    expect(meta.twitter?.images).toEqual([SITE_TWITTER_IMAGE]);
  });

  it.each(HELP_SECTION_SLUGS)(
    "%s carries its breadcrumb trail and a FAQPage of its own answers only",
    async (slug) => {
      const html = renderToStaticMarkup(await HelpSectionPage(paramsOf(slug)));
      const blocks = jsonLdOf(html);

      const crumbs = blocks.find((block) => block["@type"] === "BreadcrumbList");
      expect(crumbs).toBeDefined();
      const trail = (crumbs!.itemListElement as Array<{ name: string; item: string }>).map(
        (item) => [item.name, item.item],
      );
      expect(trail).toEqual([
        ["Home", "https://www.pipglyph.com/"],
        ["Help", "https://www.pipglyph.com/help"],
        [getHelpSection(slug)!.title, `https://www.pipglyph.com/help/${slug}`],
      ]);

      const faq = blocks.filter((block) => block["@type"] === "FAQPage");
      expect(faq).toHaveLength(1);
      const questions = (faq[0].mainEntity as Array<{ name: string }>).map((q) => q.name);
      expect(questions).toEqual(helpSectionMarkupEntries(getHelpSection(slug)!).map((e) => e.q));

      // Every answer the page shows sits under its stable anchor.
      for (const group of getHelpSection(slug)!.groups) {
        expect(html).toContain(`id="${group.id}"`);
        for (const id of group.entryIds) {
          expect(html, id).toContain(`id="${id}"`);
          expect(html, id).toContain(faqEntryById(id)!.q.replace(/'/g, "&#x27;").replace(/&(?!#)/g, "&amp;"));
        }
      }
    },
  );

  it("answers a real 404 for anything that is not a section, in the metadata and the page", async () => {
    for (const junk of ["nope", "exports", "faq", "Decks", "decks#x"]) {
      await expect(generateMetadata(paramsOf(junk)), junk).rejects.toThrow(/404/);
      await expect(HelpSectionPage(paramsOf(junk)), junk).rejects.toThrow(/404/);
    }
  });
});

describe("/help", () => {
  it("is self-canonical with OG and Twitter tags that keep the share images", () => {
    expect(hubMetadata.alternates?.canonical).toBe("/help");
    expect(hubMetadata.openGraph).toMatchObject({ url: "/help", images: [SITE_OG_IMAGE] });
    expect(hubMetadata.twitter).toMatchObject({
      card: "summary_large_image",
      images: [SITE_TWITTER_IMAGE],
    });
    expect(hubMetadata.robots).toBeUndefined();
  });

  it("links every section, marks up no answer, and keeps the old /faq anchors as ids", () => {
    const html = renderToStaticMarkup(<HelpPage />);
    for (const slug of HELP_SECTION_SLUGS) expect(html, slug).toContain(`href="/help/${slug}"`);
    const types = jsonLdOf(html).map((block) => block["@type"]);
    expect(types).toContain("CollectionPage");
    expect(types).toContain("BreadcrumbList");
    expect(types).not.toContain("FAQPage");
    for (const anchor of ["card-maker", "mana-pips", "exports", "import-remix", "accounts"]) {
      expect(html, anchor).toContain(`id="${anchor}"`);
    }
    // A labelled search box.
    expect(html).toMatch(/<label[^>]*>Search the help centre<\/label>/);
    expect(html).toContain('role="search"');
  });
});
