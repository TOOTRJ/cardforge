import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkMdx from "remark-mdx";
import remarkGfm from "remark-gfm";
import { isSafeArticleHref } from "@/lib/content/article-shared";

// ---------------------------------------------------------------------------
// What a COMPOSER article's body may hold (stored XSS, review of #696). The
// body is MDX written in the browser and stored in the database, and MDX
// passes any JSX element through — next-mdx-remote's blockJS strips
// JavaScript EXPRESSIONS only, so `<script>`, `<iframe srcdoc>`,
// `<meta http-equiv="refresh">`, `<form>`, `<object>`, an `<img>` from any
// host or a `<div style>` (a 500) all reached the page.
//
// ONE rule, in two places:
//   * `remarkArticleBodyGuard` — a remark step in composerArticleMdxOptions
//     (components/content/mdx-components.tsx), so a body that breaks it does
//     not COMPILE: the public page 404s it, the preview shows why, and
//     schedule / publish / a scheduled or live edit refuse it
//     (lib/content/article-body.tsx);
//   * `articleBodyProblems` — the same walk for the composer's checklist
//     (a BLOCKING item, lib/content/article-seo-checklist.ts).
//
// The rule: Markdown (GFM) plus the five article components, each with its
// own attributes only, every value a quoted string, and the ones it can't
// draw without present (ARTICLE_BODY_REQUIRED) — the compile never renders,
// so "passes the gate" has to mean "renders": a bare `href`, an
// `href={…}` blockJS empties or a <Mana> with no cost compiled, passed and
// then threw on the page (a 500). Never another element, raw HTML (MDX reads it as
// JSX, so it is an element like any other), import / export, a `{…}`
// expression (blockJS drops it silently: a mana cost typed as `{2}{R}` in
// prose vanished) or a link whose target isn't https://, a site path, a
// #fragment or mailto:. Markdown images stay: they draw through Figure,
// which draws only our own media. The MDX guides in content/articles/ are
// git-reviewed and keep articleMdxOptions — this guard is the composer's.
// Pure and client-safe.
// ---------------------------------------------------------------------------

/** The components a composer article may use, with the attributes each reads. */
export const ARTICLE_BODY_COMPONENTS: Readonly<Record<string, readonly string[]>> = {
  Mana: ["cost"],
  Callout: ["tone", "title"],
  CardRow: ["caption", "size"],
  CardScan: ["name", "printing", "artist", "src", "href"],
  Figure: ["src", "alt", "caption", "width", "height"],
};

/** The attributes a component can't draw without. */
export const ARTICLE_BODY_REQUIRED: Readonly<Record<string, readonly string[]>> = {
  Mana: ["cost"],
  CardScan: ["src", "href"],
};

type MdxAttribute ={ type: string; name?: string; value?: unknown };
type MdNode = {
  type: string;
  name?: string | null;
  url?: string;
  attributes?: MdxAttribute[];
  children?: MdNode[];
  position?: { start?: { line?: number } };
};

function at(node: MdNode): string {
  const line = node.position?.start?.line;
  return line ? ` (line ${line})` : "";
}

/** Every reason the tree is refused, in document order. */
function problemsInTree(tree: MdNode): string[] {
  const problems: string[] = [];
  const visit = (node: MdNode) => {
    switch (node.type) {
      case "mdxJsxFlowElement":
      case "mdxJsxTextElement": {
        const name = node.name ?? "";
        const allowed = Object.hasOwn(ARTICLE_BODY_COMPONENTS, name) ? ARTICLE_BODY_COMPONENTS[name] : null;
        if (!allowed) {
          problems.push(
            name
              ? `<${name}> isn't allowed${at(node)} — use Markdown or ${Object.keys(ARTICLE_BODY_COMPONENTS).map((c) => `<${c}>`).join(", ")}.`
              : `A <>…</> fragment isn't allowed${at(node)}.`,
          );
          break;
        }
        const given = new Set<string>();
        for (const attr of node.attributes ?? []) {
          if (attr.type !== "mdxJsxAttribute" || !attr.name) {
            problems.push(`<${name}> takes no {…} spread${at(node)}.`);
            continue;
          }
          if (!allowed.includes(attr.name)) {
            problems.push(`<${name}> has no "${attr.name}" attribute${at(node)}.`);
            continue;
          }
          // A value is a quoted string, always. A bare attribute arrives as
          // `true`, and blockJS DROPS a {…} value (the attribute is then
          // undefined) — either way the component got what it can't draw
          // (a 500 at render, after every check had passed). That includes
          // width={1600}: written as width="1600" it keeps its size; as an
          // expression blockJS would silently drop it.
          if (typeof attr.value !== "string") {
            problems.push(
              `<${name} ${attr.name}> needs a quoted value${at(node)} — write ${attr.name}="…"${
                attr.value === null || attr.value === undefined ? "" : ", not {…}"
              }.`,
            );
            continue;
          }
          given.add(attr.name);
          if (attr.name === "href" && !isSafeArticleHref(attr.value)) {
            problems.push(`<${name}> links to "${attr.value}"${at(node)} — use https://.`);
          }
        }
        for (const required of ARTICLE_BODY_REQUIRED[name] ?? []) {
          if (!given.has(required)) problems.push(`<${name}> needs ${required}="…"${at(node)}.`);
        }
        break;
      }
      case "mdxjsEsm":
        problems.push(`import / export isn't allowed${at(node)}.`);
        break;
      case "mdxFlowExpression":
      case "mdxTextExpression":
        problems.push(
          `A {…} expression isn't allowed${at(node)} — write a mana cost as <Mana cost="{2}{R}" />, or escape the brace as \\{.`,
        );
        break;
      case "html":
        problems.push(`Raw HTML isn't allowed${at(node)}.`);
        break;
      case "link":
      case "definition":
        if (typeof node.url === "string" && !isSafeArticleHref(node.url)) {
          problems.push(`The link "${node.url}"${at(node)} isn't https://, a site path, #… or mailto:.`);
        }
        break;
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree);
  return problems;
}

/** The remark step composerArticleMdxOptions runs FIRST: a refused body
 *  fails to compile, with every reason in the message. */
export function remarkArticleBodyGuard() {
  return (tree: MdNode) => {
    const problems = problemsInTree(tree);
    if (problems.length > 0) {
      throw new Error(`The article body was refused: ${problems.join(" ")}`);
    }
  };
}

const parser = unified().use(remarkParse).use(remarkMdx).use(remarkGfm);

/** The composer checklist's view of the same rule: [] = the body may go
 *  out; a body MDX can't parse is one problem (it couldn't render either). */
export function articleBodyProblems(body: string): string[] {
  let tree: MdNode;
  try {
    tree = parser.parse(body) as unknown as MdNode;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return [`The body isn't valid MDX: ${reason}`];
  }
  return problemsInTree(tree);
}
