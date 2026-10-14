import { compileMDX } from "next-mdx-remote/rsc";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  articleMdxOptions,
  mdxComponents,
} from "@/components/content/mdx-components";
import { extractToc, getArticle, listArticles } from "@/lib/content/articles";

// ---------------------------------------------------------------------------
// Article bodies render through next-mdx-remote with `articleMdxOptions` — the
// same object app/(marketing)/articles/[slug]/page.tsx passes. Without
// remark-gfm (CommonMark only) every guide table compiled to ONE paragraph of
// raw pipes, in 11 guides, unnoticed. These render each guide to HTML and hold
// it to its source: every Markdown table is a <table>, no stray pipes, GFM's
// other syntax (strikethrough, task lists, footnotes, bare-URL autolinks) only
// where the source asks for it, and every TOC anchor lands on a heading.
// ---------------------------------------------------------------------------

async function renderBody(source: string): Promise<string> {
  const { content } = await compileMDX({
    source,
    options: articleMdxOptions,
    components: mdxComponents,
  });
  return renderToStaticMarkup(content);
}

/** Delimiter rows (`| --- | :-: |`) outside fenced code — one per table. */
function countSourceTables(source: string): number {
  let inFence = false;
  let count = 0;
  for (const line of source.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    else if (!inFence && /^\s*\|(\s*:?-+:?\s*\|)+\s*$/.test(line)) count++;
  }
  return count;
}

function count(html: string, pattern: RegExp): number {
  return html.match(pattern)?.length ?? 0;
}

describe("article MDX rendering", () => {
  it("renders a GFM table alongside the custom components and heading ids", async () => {
    const html = await renderBody(
      [
        "## Printing checklist",
        "",
        "| Setting | Set it to | Cost |",
        "| --- | :-: | --- |",
        '| Scale | **100%** | <Mana cost="{2}{R}" /> |',
        "| Fit to page | OFF | Cardstock (~200 gsm) |",
        "",
        '<Callout tone="tip">Print one test sheet first.</Callout>',
      ].join("\n"),
    );

    expect(html).toContain('<h2 id="printing-checklist">Printing checklist</h2>');
    expect(count(html, /<table>/g)).toBe(1);
    expect(html).toMatch(/<div tabindex="0" class="overflow-x-auto[^"]*"><table>/);
    expect(count(html, /<th[ >]/g)).toBe(3);
    expect(count(html, /<td[ >]/g)).toBe(6);
    expect(html).toContain("<strong>100%</strong>");
    expect(html).toMatch(/<td><span [^>]*aria-label="Cost \{2\}\{R\}"/); // <Mana> in a cell
    expect(html).toContain("Cardstock (~200 gsm)"); // a lone ~ is not strikethrough
    expect(html).toContain("<aside");
    expect(html).not.toContain("|");
  });

  const articles = listArticles();

  it.each(articles.map((a) => a.slug))("renders %s faithfully", async (slug) => {
    const article = getArticle(slug);
    if (!article) throw new Error(`missing article ${slug}`);
    const { content } = article;
    const html = await renderBody(content);

    // Tables: one <table> per Markdown table, and no pipe row left as prose.
    expect(count(html, /<table>/g)).toBe(countSourceTables(content));
    expect(html).not.toMatch(/<p>\s*\|/);

    // GFM extras appear only where the source writes them.
    if (!content.includes("~~")) expect(html).not.toContain("<del>");
    if (!/^\s*[-*+] \[[ xX]\]/m.test(content)) expect(html).not.toContain('type="checkbox"');
    if (!content.includes("[^")) expect(html).not.toContain("data-footnote");

    // No autolinked bare URLs: every rendered href is a link the source wrote.
    for (const [, href] of html.matchAll(/<a [^>]*href="([^"]*)"/g)) {
      const raw = href.replace(/&amp;/g, "&");
      // …as Markdown, or as the `href` of a component it placed (<CardScan>).
      // …or the two anchors GFM draws for a footnote the source wrote.
      const footnote = content.includes("[^") && raw.startsWith("#user-content-fn");
      const written =
        footnote || content.includes(`](${raw}`) || content.includes(`href="${raw}"`);
      expect(written, `${slug}: unexpected link ${raw}`).toBe(true);
    }

    // A link that leaves the site opens a new tab and never takes the reader
    // away (owner 2026-10-14) — body links, footnotes and card pictures alike.
    for (const [tag, href] of html.matchAll(/<a ([^>]*href="(?:https?:)?\/\/[^"]*"[^>]*)>/g)) {
      expect(tag, `${slug}: ${href}`).toContain('target="_blank"');
      expect(tag, `${slug}: ${href}`).toMatch(/rel="[^"]*noopener[^"]*"/);
    }

    // The TOC is lifted from the raw Markdown; each anchor must hit a heading.
    for (const { depth, id } of extractToc(content)) {
      expect(html, `${slug}: TOC anchor #${id}`).toContain(`<h${depth} id="${id}">`);
    }
  });
});
