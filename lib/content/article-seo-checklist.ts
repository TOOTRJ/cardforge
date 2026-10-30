import { isAllowedMediaUrl } from "@/lib/media/media-urls";
import {
  bodyHeadings,
  bodyImages,
  bodyLinks,
  bodyPlainText,
  firstParagraph,
  isSafeArticleHref,
  wordCount,
  type ArticleFaqItem,
} from "@/lib/content/article-shared";

// ---------------------------------------------------------------------------
// The pre-publish SEO checklist — docs/research/article-seo-2026-10.md's
// ranked recommendations as checks. The composer shows it live; the server
// runs the same function before a schedule or a publish and refuses while any
// ERROR stands (a warning is advice: the admin may publish past it).
//
// Pure and client-safe. Every check names the recommendation it comes from
// (`rec`, the research doc's numbering) so the two stay in step.
// ---------------------------------------------------------------------------

export type ChecklistLevel = "error" | "warning";

export type ChecklistItem = {
  id: string;
  /** What the check asks for, as a line of the list. */
  label: string;
  /** "error" blocks scheduling and publishing; "warning" is advice. */
  level: ChecklistLevel;
  ok: boolean;
  /** Why it matters / what to change — shown when the check fails. */
  hint: string;
  /** The research doc's recommendation number. */
  rec: number;
};

export type ChecklistInput = {
  slug: string;
  title: string;
  seoTitle?: string | null;
  description: string;
  body: string;
  tags: string[];
  category: string | null;
  faq: ArticleFaqItem[];
  coverUrl?: string | null;
  coverAlt?: string | null;
  authorId?: string | null;
  publishAt?: string | null;
};

export type ChecklistContext = {
  /** Slugs the MDX guides own — a composer article may not take one. */
  fileSlugs?: readonly string[];
  /** Every article slug the site knows (files + composer), to check that an
   *  /articles/<slug> link goes somewhere. */
  knownSlugs?: readonly string[];
  /** Other composer articles' release times (scheduled or live), for the
   *  backlog's spacing. */
  otherPublishTimes?: readonly string[];
};

/** The site appends this to every <title> (app/layout.tsx's template). */
export const TITLE_SUFFIX = " · PipGlyph";
export const TITLE_MAX = 60;
export const DESCRIPTION_RANGE = { min: 70, max: 160 } as const;
export const MIN_WORDS = 300;
export const TARGET_WORDS = 800;
export const ANSWER_FIRST_MAX_WORDS = 80;
export const LONG_PARAGRAPH_WORDS = 120;
export const MIN_INTERNAL_LINKS = 3;
export const ALT_MAX = 125;
export const MIN_SPACING_HOURS = 48;

/** The tool pages an article can send a reader to. */
const TOOL_PATHS = [
  "/create",
  "/mtg-card-maker",
  "/ai-mtg-card-generator",
  "/mana-pip-editor",
  "/best-mtg-card-makers",
  "/decks",
  "/gallery",
  "/challenges",
  "/tools",
];

/** How a shipped draft marks a picture the owner still has to make. */
export const IMAGE_PLACEHOLDER = /IMAGE PLACEHOLDER/;

const VAGUE_ANCHORS = /^(click here|here|this|this page|read more|more|link|learn more)$/i;
const QUESTION_HEADING = /^(how|what|why|when|where|which|who|can|should|is|are|do|does)\b|\?$/i;

function internalPath(href: string): string | null {
  if (!href.startsWith("/") || href.startsWith("//")) return null;
  return href.split(/[?#]/)[0] || "/";
}

export function articleSeoChecklist(
  input: ChecklistInput,
  context: ChecklistContext = {},
): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  const add = (item: ChecklistItem) => items.push(item);

  const body = input.body ?? "";
  const plain = bodyPlainText(body);
  const words = wordCount(plain);
  const images = bodyImages(body);
  const links = bodyLinks(body);
  const headings = bodyHeadings(body);
  const internal = links.map((l) => internalPath(l.href)).filter((p): p is string => p !== null);

  // --- Identity -----------------------------------------------------------
  add({
    id: "slug-free",
    label: "The URL is the article's own",
    level: "error",
    ok: !(context.fileSlugs ?? []).includes(input.slug),
    hint: "A guide in content/articles/ already lives at this /articles/ URL. Pick another slug.",
    rec: 3,
  });
  add({
    id: "category",
    label: "It sits on a /learn shelf",
    level: "error",
    ok: Boolean(input.category),
    hint: "Pick a category: it is the breadcrumb, the /learn shelf and the topic cluster the article joins.",
    rec: 3,
  });

  const shownTitle = `${(input.seoTitle || input.title).trim()}${TITLE_SUFFIX}`;
  add({
    id: "title-length",
    label: `The search title fits in about ${TITLE_MAX} characters`,
    level: "warning",
    ok: shownTitle.length <= TITLE_MAX && (input.seoTitle || input.title).trim().length >= 20,
    hint: `"${shownTitle}" is ${shownTitle.length} characters. Results cut long titles; use the SEO title field for a shorter one that leads with the query people type.`,
    rec: 4,
  });

  const descLength = input.description.trim().length;
  add({
    id: "description-length",
    label: `The summary is ${DESCRIPTION_RANGE.min}–${DESCRIPTION_RANGE.max} characters`,
    level: "warning",
    ok: descLength >= DESCRIPTION_RANGE.min && descLength <= DESCRIPTION_RANGE.max,
    hint: `It is ${descLength}. The summary is the meta description, the OG text and the RSS line: one or two sentences that say what the reader gets.`,
    rec: 4,
  });

  // --- Answer first ---------------------------------------------------------
  const opening = firstParagraph(body);
  const openingWords = opening ? wordCount(bodyPlainText(opening)) : 0;
  add({
    id: "answer-first",
    label: "The article opens with the answer",
    level: "warning",
    ok: Boolean(opening) && openingWords >= 15 && openingWords <= ANSWER_FIRST_MAX_WORDS,
    hint: opening
      ? `The first paragraph is ${openingWords} words. Answer the title's question in 40–60 words before the first heading — that is the passage answer engines lift.`
      : "Start with a paragraph, not a heading: the direct answer to the title, in 40–60 words.",
    rec: 1,
  });
  add({
    id: "question-headings",
    label: "At least two sections are headed by the questions people ask",
    level: "warning",
    ok: headings.filter((h) => h.depth >= 2 && QUESTION_HEADING.test(h.text)).length >= 2,
    hint: "Phrase some H2 / H3s as the questions readers type (How…, What…, Can…?) and answer each in its first sentence.",
    rec: 1,
  });
  const longParagraphs = body
    .split(/\n\s*\n/)
    .filter((block) => !/^\s*(#|<|!\[|\||-|\*|\d+\.)/.test(block))
    .filter((block) => wordCount(bodyPlainText(block)) > LONG_PARAGRAPH_WORDS).length;
  add({
    id: "short-paragraphs",
    label: `No paragraph runs past ${LONG_PARAGRAPH_WORDS} words`,
    level: "warning",
    ok: longParagraphs === 0,
    hint: `${longParagraphs} paragraph(s) are longer. Self-contained passages of 40–120 words are easier to read and to quote.`,
    rec: 1,
  });

  // --- Substance and structure --------------------------------------------
  add({
    id: "length-min",
    label: `At least ${MIN_WORDS} words`,
    level: "error",
    ok: words >= MIN_WORDS,
    hint: `It has ${words}. A thin page helps nobody — finish the draft before it goes out.`,
    rec: 2,
  });
  add({
    id: "length-target",
    label: `Around ${TARGET_WORDS}+ words of substance`,
    level: "warning",
    ok: words >= TARGET_WORDS,
    hint: `It has ${words}. The guides that earn links cover the topic completely; never pad, but check nothing a reader needs is missing.`,
    rec: 2,
  });
  const h2s = headings.filter((h) => h.depth === 2);
  add({
    id: "sections",
    label: "At least three H2 sections",
    level: "warning",
    ok: h2s.length >= 3,
    hint: "H2s build the table of contents and give each passage a heading a search result can jump to.",
    rec: 1,
  });
  add({
    id: "no-h1",
    label: "No H1 inside the body",
    level: "warning",
    ok: !headings.some((h) => h.depth === 1),
    hint: "The page prints the title as its one H1; start body headings at ## (H2).",
    rec: 4,
  });
  let skipped = false;
  let previous = 1;
  for (const h of headings) {
    if (h.depth > previous + 1) skipped = true;
    previous = h.depth;
  }
  add({
    id: "heading-order",
    label: "Headings go in order (no H2 → H4 jump)",
    level: "warning",
    ok: !skipped,
    hint: "A skipped level confuses screen readers and the table of contents.",
    rec: 10,
  });
  add({
    id: "faq",
    label: "Three or more FAQ items",
    level: "warning",
    ok: input.faq.length >= 3,
    hint: "The FAQ prints under the article and as FAQPage data. Google shows FAQ rich results only for authoritative health and government sites, but the questions are what answer engines and People Also Ask match.",
    rec: 5,
  });
  add({
    id: "faq-answers",
    label: "Every FAQ answer stands on its own (2+ sentences, under 120 words)",
    level: "warning",
    ok: input.faq.every((f) => {
      const n = wordCount(f.a);
      return n >= 12 && n <= 120;
    }),
    hint: "An answer is quoted alone: name the subject again instead of 'it', and keep it to a short paragraph.",
    rec: 5,
  });

  // --- Links ---------------------------------------------------------------
  const unsafe = links.filter((l) => !isSafeArticleHref(l.href));
  add({
    id: "links-safe",
    label: "Every link is https:// or a site path",
    level: "error",
    ok: unsafe.length === 0,
    hint: `Fix: ${unsafe.map((l) => l.href).slice(0, 3).join(", ")}`,
    rec: 3,
  });
  add({
    id: "internal-links",
    label: `At least ${MIN_INTERNAL_LINKS} links to other PipGlyph pages`,
    level: "warning",
    ok: internal.length >= MIN_INTERNAL_LINKS,
    hint: `It has ${internal.length}. Link the guides and tools a reader needs next — that is how the cluster and the new page get found.`,
    rec: 3,
  });
  add({
    id: "tool-link",
    label: "It links to a PipGlyph tool (the creator, decks, the gallery…)",
    level: "warning",
    ok: internal.some((p) => TOOL_PATHS.some((t) => p === t || p.startsWith(`${t}/`))),
    hint: "Send the reader somewhere to try what they read: /create, /decks, /gallery…",
    rec: 3,
  });
  const articleLinks = internal.filter((p) => p.startsWith("/articles/") && !p.startsWith("/articles/tag/"));
  add({
    id: "guide-link",
    label: "It links to at least one other guide",
    level: "warning",
    ok: articleLinks.some((p) => p !== `/articles/${input.slug}`),
    hint: "Link a related guide in the body — the 'More guides' list at the foot doesn't count as context.",
    rec: 3,
  });
  if (context.knownSlugs) {
    const known = new Set(context.knownSlugs);
    const broken = articleLinks
      .map((p) => p.slice("/articles/".length).split("/")[0])
      .filter((s) => s && !known.has(s) && s !== input.slug);
    add({
      id: "links-resolve",
      label: "Every /articles/ link goes to a real guide",
      level: "warning",
      ok: broken.length === 0,
      hint: `Unknown: ${[...new Set(broken)].join(", ")}. (A guide still in the backlog is fine once it is live first.)`,
      rec: 3,
    });
  }
  const vague = links.filter((l) => VAGUE_ANCHORS.test(l.text));
  add({
    id: "anchor-text",
    label: "Link text says where it goes",
    level: "warning",
    ok: vague.length === 0,
    hint: `Replace "${vague[0]?.text ?? ""}" with words that describe the target page.`,
    rec: 3,
  });

  // --- Images --------------------------------------------------------------
  const missingAlt = images.filter((img) => !img.alt);
  add({
    id: "image-alt",
    label: "Every image has alt text",
    level: "error",
    ok: missingAlt.length === 0 && (!input.coverUrl || Boolean(input.coverAlt?.trim())),
    hint: "Describe what the picture shows (and why it is there). Alt text is required.",
    rec: 6,
  });
  const badSrc = images.filter((img) => !isAllowedMediaUrl("article-image", img.src));
  add({
    id: "image-source",
    label: "Every image is an upload or a PipGlyph diagram",
    level: "error",
    ok: badSrc.length === 0 && (!input.coverUrl || isAllowedMediaUrl("article-image", input.coverUrl)),
    hint: "Upload pictures through the composer (or use /article-media/ diagrams). Outside images are not drawn — and never Wizards of the Coast art.",
    rec: 6,
  });
  add({
    id: "no-placeholder",
    label: "No image placeholder left in the body",
    level: "error",
    ok: !IMAGE_PLACEHOLDER.test(body),
    hint: "A draft marks a picture still to be made with “IMAGE PLACEHOLDER”. Make the picture (or cut the block) before it goes out.",
    rec: 6,
  });
  const allAlts = [...images.map((i) => i.alt), input.coverAlt ?? ""].filter(Boolean);
  add({
    id: "alt-quality",
    label: `Alt text is a description, under ${ALT_MAX} characters`,
    level: "warning",
    ok: allAlts.every(
      (alt) =>
        alt.length <= ALT_MAX &&
        !/\.(png|jpe?g|webp|gif|svg)$/i.test(alt) &&
        !/^(image|picture|photo|graphic) of\b/i.test(alt),
    ),
    hint: "Not a file name, not 'image of…' — say what is in it, briefly. Put the long explanation in the caption.",
    rec: 6,
  });
  add({
    id: "captions",
    label: "Body images carry a caption",
    level: "warning",
    ok: images.every((img) => Boolean(img.title?.trim())),
    hint: 'Captions are read more than body text; add one ("![alt](src "caption")" or <Figure caption="…" />).',
    rec: 6,
  });
  add({
    id: "cover",
    label: "A cover image (with alt text)",
    level: "warning",
    ok: Boolean(input.coverUrl && input.coverAlt?.trim()),
    hint: "The cover is the Article's image in search and the picture under the headline. Without one the generated share card stands in.",
    rec: 6,
  });

  // --- People and freshness ------------------------------------------------
  add({
    id: "author",
    label: "A named author",
    level: "warning",
    ok: Boolean(input.authorId),
    hint: "A byline that links to a real profile is the cheapest E-E-A-T signal. Without one it reads 'the PipGlyph Team'.",
    rec: 7,
  });
  add({
    id: "tags",
    label: "Two to six tags",
    level: "warning",
    ok: input.tags.length >= 2 && input.tags.length <= 6,
    hint: "Reuse existing tags so the article joins their hubs; a tag no other guide uses makes a hub of one.",
    rec: 3,
  });
  if (input.publishAt && context.otherPublishTimes?.length) {
    const at = new Date(input.publishAt).getTime();
    const close = context.otherPublishTimes.filter(
      (t) => Math.abs(new Date(t).getTime() - at) < MIN_SPACING_HOURS * 3_600_000,
    );
    add({
      id: "spacing",
      label: `No other article goes out within ${MIN_SPACING_HOURS} hours`,
      level: "warning",
      ok: close.length === 0,
      hint: "Spread the backlog: a steady cadence keeps the site fresh and gives each article its own crawl and share.",
      rec: 8,
    });
  }

  return items;
}

/** The checks that block a schedule or a publish. */
export function blockingItems(items: readonly ChecklistItem[]): ChecklistItem[] {
  return items.filter((item) => item.level === "error" && !item.ok);
}
