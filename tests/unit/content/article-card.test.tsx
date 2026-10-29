import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ArticleCard } from "@/components/content/article-card";
import { getArticle } from "@/lib/content/articles";

// ---------------------------------------------------------------------------
// ArticleCard's tag badges: each links to its hub (or the /learn category a
// retired hub became) — except the badge that would link to the very page
// the card is drawn on, which is plain text (16 self-links on /learn/design
// otherwise).
// ---------------------------------------------------------------------------

const article = getArticle("how-to-write-mtg-oracle-text")!.meta;
const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

describe("ArticleCard tag badges", () => {
  it("link every tag when the page is not one of their hubs", () => {
    expect(article.tags).toEqual(["oracle text", "card design"]);
    const links = hrefs(renderToStaticMarkup(<ArticleCard article={article} />));
    expect(links).toContain("/articles/tag/oracle-text");
    expect(links).toContain("/learn/design");
  });

  it("draw the current page's own badge as text, never a link to itself", () => {
    const html = renderToStaticMarkup(<ArticleCard article={article} currentPath="/learn/design" />);
    expect(hrefs(html)).not.toContain("/learn/design");
    expect(hrefs(html)).toContain("/articles/tag/oracle-text");
    expect(html).toContain(">card design<");

    const onHub = renderToStaticMarkup(
      <ArticleCard article={article} currentPath="/articles/tag/oracle-text" />,
    );
    expect(hrefs(onHub)).not.toContain("/articles/tag/oracle-text");
    expect(hrefs(onHub)).toContain("/learn/design");
  });
});
