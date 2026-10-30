# Article SEO and AI-search visibility: research and ranked recommendations (2026-10)

What makes ONE article on PipGlyph rank in classic search and get quoted by
answer engines (Google AI Overviews / AI Mode, ChatGPT search, Copilot,
Perplexity, Claude). Researched 2026-10-30 for the admin article composer
(`/admin/articles`, migration 0153). Each recommendation says what the
evidence is, what PipGlyph now does by default, and what is left. "What we
do" describes the composer and article pages built alongside this document
(the admin articles PR); until it merges, the MDX guides already have the
Article / BreadcrumbList / FAQPage data, honest dates,
static pages and the generated share card.

**How to read the sources.** This session could search the web but could
not open `developers.google.com` and a few other hosts (the cloud
environment's network policy). Every claim below was checked against
search-result snippets of the pages cited, and the key ones against two or
more independent reports. Primary sources (Google Search Central, web.dev,
Bing, OpenAI, the GEO paper) are marked **[P]**; trade press and vendor
studies **[S]**; single-source or disputed numbers **[U]**. Before quoting
a number in public, open the primary page.

## TL;DR

1. **There is no separate "AI SEO".** Google says a page only has to be
   indexed and eligible for a snippet to appear in AI Overviews and AI Mode;
   no special files or markup are needed [P: 37, 55]. What gets cited is
   clear, original, well-structured content that is easy to find. Optimise
   the article, not a side channel.
2. **Lead with the answer.** In an 18,012-citation study, 44 % of ChatGPT
   citations came from the first 30 % of the page [S: 63]. The composer now
   checks the opening paragraph and the question-led headings.
3. **Be the source.** The GEO paper found that adding citations, quotations
   and statistics raised visibility in generative answers by over 40 % [P:
   65]. First-hand, specific, people-first content is also Google's own
   bar [P: 21]. PipGlyph's edge is that it can show its own renders and
   tools, which no other site has.
4. **Structured data:** Article + BreadcrumbList on every guide, plus
   FAQPage for a visible FAQ. FAQ rich results are **gone** from Google
   (no longer shown since 7 May 2026) [S: 8, 85, 86], and HowTo since
   September 2023 [P: 7]. Google still parses the markup, and Bing says
   schema helps Copilot understand a page [S: 12]. Keep FAQPage, and skip
   HowTo.
5. **Freshness must be honest.** Google uses `lastmod` and `dateModified`
   only when they keep proving accurate [P: 44, 43]. The "Updated" date now
   moves only when an admin marks an edit as a real revision.
6. **Announce every publish:** IndexNow (Bing, and Copilot / ChatGPT search
   through it; not Google) [S: 48, 14], the sitemap with real dates, RSS,
   and `llms.txt`. `llms.txt` is cheap but unproven: Google ignores it
   [P: 55] and logs show AI crawlers barely fetch it [U: 59, 60].

## Ranked recommendations

Ranked by expected impact per article × how reliably it can be enforced.
The numbers are the `rec` each check in
`lib/content/article-seo-checklist.ts` points back to. **Error** = the
server refuses a schedule, a publish or a live edit until it is fixed.
**Advice** = a warning in the composer.

| # | Recommendation | Composer check(s) | Level |
|---|---|---|---|
| 1 | Answer first; self-contained, question-led passages | `answer-first`, `question-headings`, `short-paragraphs`, `sections` | advice |
| 2 | Substance: complete, first-hand, sourced; never thin | `length-min` (error), `length-target` | error + advice |
| 3 | Internal links and topic clusters | `category` (error), `slug-free` (error), `links-safe` (error), `internal-links`, `tool-link`, `guide-link`, `links-resolve`, `anchor-text`, `tags` | error + advice |
| 4 | Titles, meta descriptions, Open Graph | `title-length`, `description-length`, `no-h1` | advice |
| 5 | Structured data and a visible FAQ | `faq`, `faq-answers` (+ JSON-LD built automatically) | advice |
| 6 | Images: our own, alt text, captions, sized | `image-alt` (error), `image-source` (error), `alt-quality`, `captions`, `cover` | error + advice |
| 7 | E-E-A-T: a named author with an author page | `author` | advice |
| 8 | Honest freshness and a steady cadence | `spacing` (+ the revision switch) | advice |
| 9 | Announce every publish (IndexNow, sitemap, RSS, llms.txt) | automatic | — |
| 10 | Core Web Vitals and accessible structure | `heading-order` (+ rendering defaults) | advice |

### 1. Lead with the answer; write self-contained, question-led passages

**Evidence.**
- Kevin Indig's study of 18,012 ChatGPT citations found a "ski-ramp"
  shape: 44 % of citations come from the first 30 % of a page, 31 % from the
  middle and 25 % from the end. Inside a paragraph, 53 % come from the
  middle sentences. This is a correlation, not a mechanism [S: 63, 64].
- Google's guidance runs the other way on format: AEO/GEO is "still SEO",
  and you do not need to chunk content into tiny pieces for AI [P: 37, 55].
- The popular rule of a "40–60 word direct answer" is vendor folklore. No
  primary study backs that number [U: 67, 68].
- Optimising for one engine does not carry over: only ~11 % of domains are
  cited by both ChatGPT and Perplexity [S: 69].

**What we do.** These are advice, never errors, because Google warns
against writing for machines:
- The composer checks that the body opens with a paragraph (not a heading)
  of 15–80 words that answers the title.
- At least two headings should be phrased as the questions readers ask.
- At least three H2 sections.
- No paragraph over 120 words: self-contained passages are easier to read
  and to quote.

The five drafts follow the pattern. Each opens with a 40–70-word answer,
then has question-led sections that each answer themselves in their first
sentence.

### 2. Substance: complete, first-hand, sourced, never thin

**Evidence.**
- Google's helpful-content guidance asks for original information,
  first-hand expertise and depth. It also asks "Who, How and Why": who made
  the content, how it was made (AI assistance included), and why [P: 21,
  22].
- Raters may give scaled, unoriginal "filler" content the Lowest rating
  [S: 25, 26].
- The GEO paper (Aggarwal et al., KDD 2024) found that adding citations,
  quotations from relevant sources and statistics raised visibility in
  generative engines by over 40 %. Keyword stuffing did little [P: 65].
- Google's AI-features guide asks for "unique, non-commodity" content
  [P: 37].

**What we do.**
- A body under 300 words is an **error**; under 800 is advice. Length is
  not a ranking factor; the floor stops a stub from shipping.
- The drafts cite sources and lean on what only PipGlyph can show: its own
  renders, its frames and its creator's workflow.

**Left to the writer.** First-hand experience can't be checked by a
function. The owner's review of each draft is the gate.

### 3. Internal links and topic clusters

**Evidence.**
- Google can follow only `<a href>` links. Anchor text should be
  "descriptive, reasonably concise, and relevant" to both pages [P: 29, 30,
  31].
- Google reads internal anchors when it builds title links [P: 34].
- A logical site structure, with similar topics grouped, helps crawling
  [P: 32].
- Hub-and-spoke "topic clusters" are industry practice, not a documented
  Google system. The usual failures are hubs that don't link down to their
  spokes, and orphan pages [S: 33].

**What we do.**
- Every composer article must sit on a `/learn` category (**error**).
  That category is its breadcrumb and its shelf.
- It joins the existing tag hubs (`/articles/tag/<tag>`), and the advice
  is to reuse existing tags so it lands in a real hub.
- The checklist asks for:
  - at least 3 internal links;
  - one link to a tool (`/create`, `/decks`, `/gallery`…);
  - one link to another guide;
  - `/articles/` links that resolve;
  - no vague anchors ("click here").
- Unsafe hrefs (`javascript:`, `//host`) are an **error**.
- The page adds the "More guides" list (shared tags), and the hubs list it
  the moment it is released, because every surface reads one catalog
  (`lib/content/article-catalog.ts`).

### 4. Titles, meta descriptions, Open Graph

**Evidence.**
- Google builds title links from the `<title>`, the main heading and
  anchors. It truncates them "to fit the device width" and may rewrite
  boilerplate or over-long titles. "There is no limit" on the element
  itself [P: 34, 35].
- Meta descriptions are used when they describe the page better than the
  body does. They have no length limit and are not a ranking factor [P: 36].
- `og:image`: at least 1200 × 630 for high-resolution displays, ratio about
  1.91:1 [P: 38]. X falls back to `og:image` [S: 40].

**What we do.**
- The composer shows the title as it will appear ("… · PipGlyph") with a
  60-character budget.
- An optional SEO title keeps the H1 natural while the `<title>` leads
  with the query.
- The summary is checked at 70–160 characters. It is the meta description,
  the OG text and the RSS line.
- An H1 inside the body is flagged; the page prints the title as its one
  H1.
- Every guide already gets a generated 1200 × 630 share card
  (`/articles/<slug>/opengraph-image`). It now reads composer articles too.

### 5. Structured data and a visible FAQ

**Evidence.**
- **Article:** there are no required properties. Google recommends
  `headline`, `image` (several aspect ratios: 16×9, 4×3, 1×1, at least
  50K pixels), `datePublished`, `dateModified` with a timezone, and
  `author` as a `Person` with a `url` [P: 1, 3, 4, 5, 6].
- **BreadcrumbList:** still supported. Since January 2025 it shows on
  desktop only [P: 17, 18].
- **FAQPage:**
  - Restricted to authoritative government and health sites in August 2023
    [P: 7].
  - No longer shown at all since 7 May 2026. Search Console reporting went
    in June 2026, and API support ends in August 2026 [S: 8, 9, 85, 86].
  - Google says it still parses the markup to understand the page [S: 85].
- **HowTo:** deprecated in September 2023 [P: 7].
- Other engines: Bing says schema helps Copilot's models understand content,
  but gave no data [S: 12, 13, 14]. Studies on FAQ schema and AI citations
  contradict each other [U: 15, 16].
- Google keeps retiring rich-result types (June and November 2025), but
  Article, Breadcrumb and ProfilePage are untouched [P: 19, 20].

**What we do.** Every guide gets, with nothing for the writer to do:
- Article JSON-LD with:
  - `headline`, `description` and `articleSection`;
  - `datePublished`, and `dateModified` taken from an honest update only;
  - `image`: the cover with its size, plus the 1200 × 630 share card;
  - `author`: a Person with a profile URL and `sameAs`, or else the
    organization;
  - `publisher`, `wordCount`, `inLanguage` and `isAccessibleForFree`.
- BreadcrumbList, from the visible trail.
- FAQPage. A composer article **prints** its FAQ under the body, so the
  marked-up questions are on the page.

We do not emit HowTo: an ordered list in the body carries the same steps for
readers and for models. The checklist asks for 3+ FAQ items whose answers
stand alone (12–120 words, naming the subject again instead of "it").

### 6. Images: our own, alt text, captions, sized

**Evidence.**
- Google calls alt text the most important image metadata. Put images near
  relevant text, use descriptive filenames, and use `<img>`, not CSS
  backgrounds. Captions and nearby text tell Google what the image is
  about [P: 71, 72, 73].
- Decorative images get `alt=""`. Keep alt text short: Google's style guide
  suggests ~155 characters or fewer [P: 74, 75].
- Set width and height (or `aspect-ratio`) to avoid layout shift [P: 84].

**What we do.**
- Missing alt text is an **error**, and so is any picture that isn't ours:
  an upload in our storage, or a diagram under `/article-media/`, checked by
  `isAllowedMediaUrl("article-image")`. The database checks the cover too:
  `articles_cover_has_alt` and the 0127-style guard.
- The composer asks for alt text **before** it uploads a body image. It
  stores the image as WebP of at most 1600 px and inserts a `<Figure>` with
  width, height and caption.
- Alt text that is a filename or starts "image of…" is flagged, and so is
  alt text over 125 characters. Body images without captions are flagged.
- Wizards of the Coast art is never stored. A printed card is still only a
  `<CardScan>` served by Scryfall, as in the MDX guides.

### 7. E-E-A-T: a named author with an author page

**Evidence.**
- Google "strongly encourage[s]" accurate authorship. Bylines should be
  present where readers expect them and lead to more about the author
  [P: 21].
- `author.url` helps Google "uniquely identify" an author [S: 5, 6].
- ProfilePage markup (`mainEntity` Person, `sameAs`) suits creator pages
  [P: 27], and PipGlyph's profiles already carry it.
- E-E-A-T is a rater framework, not a ranking factor in itself. Trust is
  its most important part [P: 21, 23].
- Fake authors and AI headshots count as deception [P: 21].

**What we do.**
- The composer's byline is an admin profile. The page links the name to
  `/profile/<username>` (`rel="author"`) and shows the profile's bio as
  "About the author".
- The JSON-LD names a Person with that URL and the profile's public links
  as `sameAs`.
- No byline means "the PipGlyph Team" (Organization). The draft import
  never invents an author: the owner picks one.

**Left.** Author pages are profile pages today. A dedicated
`/articles/author/<handle>` listing an author's guides is a follow-up if
the team grows. Disclose AI assistance in the article itself where it was
material (Google's "How").

### 8. Honest freshness and a steady cadence

**Evidence.**
- Show a visible date, and use exactly the same date in the markup. Change
  it only for a significant update; showing both published and updated
  dates is fine [P: 42, 43].
- Google uses `lastmod` only when it proves accurate over time, and ignores
  `changefreq` and `priority` [P: 44, 45, 46].

**What we do.**
- The page shows "Published" plus "Updated" only when an admin ticked
  "This is a real revision" on an edit of a live article
  (`content_updated_at`). A typo fix never moves it.
- The sitemap's `lastmod` is the same date, and so is `dateModified`. The
  sitemap never stamps the build time; that was already the rule.
- The composer suggests the next open slot (three days after the last
  scheduled article, 15:00 UTC) and warns when two articles would go out
  within 48 hours.

### 9. Announce every publish

**Evidence.**
- IndexNow is used by Bing, Yandex, Naver, Seznam and Yep, which share
  submissions. Google does not take part [S: 48, 49, 50].
- Bing presents IndexNow as how it keeps search and AI answers fresh
  [P: 14, 51, 52]. Bing Webmaster Tools' "AI Performance" report (February
  2026) shows Copilot citations [P: 51].
- Sites that block OAI-SearchBot are not shown in ChatGPT search answers
  [P: 70]. PipGlyph's `robots.txt` lets every crawler read public pages.
- `llms.txt` (proposed September 2024) is ignored by Google Search, which
  says it neither helps nor hurts [P: 55]. Log studies find AI crawlers
  almost never request it [U: 59, 60].

**What we do.** A release runs in one place, `announceDueArticles`
(`lib/content/article-publish.ts`): the scheduled job
`/api/cron/publish-articles` every 10 minutes, or the composer's "Publish
now". It:
- purges every guide surface: the page, `/articles`, its tag hubs, `/learn`
  and its shelf, the homepage, `/sitemap.xml`, `/llms.txt` and
  `/articles/feed.xml`;
- tells IndexNow about the article and the hubs that now link to it;
- stamps `announced_at`, so each release is announced once.

A live edit and an unpublish announce too.

### 10. Core Web Vitals and accessible structure

**Evidence.**
- The thresholds are LCP ≤ 2.5 s, INP ≤ 200 ms (INP replaced FID on
  12 March 2024) and CLS ≤ 0.1, measured at the 75th percentile [P: 76,
  77, 78, 79].
- Google says Core Web Vitals are used by its ranking systems, but page
  experience is not a single signal [P: 80, 81].
- Give the LCP image `fetchpriority="high"` and never lazy-load it [P: 82,
  83]. Give every image dimensions [P: 84].

**What we do.**
- Article pages are static or ISR, with no client JavaScript in the body.
- The cover is the probable LCP image. It is drawn eager with
  `fetchPriority="high"` and its stored width and height. Body figures are
  lazy, with dimensions.
- Uploads are capped at 1600 px WebP.
- Headings are checked for order (no H2 → H4 jump), for screen readers and
  for the table of contents.

## Architecture decision: database articles JOIN the MDX files

The 29 MDX guides stay files. Composer articles live in `public.articles`
and share the same `/articles/<slug>` URL space, the same shelves and tag
hubs, and the same page component. Why not replace the files:

- **Every existing URL and its SEO keeps working unchanged.** That covers
  frontmatter dates, FAQ, `<CardScan>` rows, the tests that render every
  guide, and the 308s from old tag hubs. A migration of 29 guides into rows
  would re-date them and risk subtle rendering changes, for no reader
  benefit.
- **Files are good at what they do:** reviewed in PRs, versioned, built
  statically. The composer is good at scheduling a backlog without a
  deploy.
- **One catalog keeps them equal.** `lib/content/article-catalog.ts` merges
  both, and every public surface reads it. A file wins a slug clash, and
  the composer refuses a file's slug. If the owner later wants one system,
  importing the files as rows is a script away.

Scheduling uses **both** suggested mechanisms. RLS makes a row public at
`publish_at <= now()`, so a page can never go out early or stay out late
beyond the 5-minute cache. The cron then makes the release land everywhere
at once and fires IndexNow, which render time can't do.

## What we deliberately did not build

- **HowTo markup:** deprecated by Google, no evidence of value elsewhere.
- **An `llms-full.txt` or per-article Markdown mirrors:** no engine is
  shown to read them. Revisit if one announces support.
- **Chunked micro-sections written for machines:** Google advises against
  it.
- **Keyword-density or readability-score checks:** not in any primary
  guidance. They would push writing toward formula.

## Measuring

Measure in four places:
- **Google Search Console:** the Performance report, and the "Search
  Generative AI" performance report as it rolls out (June 2026) [P: 62].
- **Bing Webmaster Tools:** the IndexNow submissions, and AI Performance
  for Copilot citations [P: 51].
- **Vercel Analytics:** Core Web Vitals per article.
- **Spot checks:** ask ChatGPT, Perplexity and Google the question an
  article answers, a month after it publishes.

## Sources

Gathered 2026-10-30 from web-search results (see the note at the top).

1. Article structured data — Google Search Central. https://developers.google.com/search/docs/appearance/structured-data/article
3. General structured data guidelines — Google Search Central. https://developers.google.com/search/docs/appearance/structured-data/sd-policies
4. Article structured data (zh-TW mirror of Google's page; 16×9 / 4×3 / 1×1, 50K px). https://arrahmah.netlify.app/host-https-developers.google.com/search/docs/appearance/structured-data/article?hl=zh-tw
5. Google adds author markup to Article recommended properties — Search Engine Roundtable (2021). https://seroundtable.com/google-author-article-31889.html
6. Google adds author URL property — Search Engine Land (2021). https://searchengineland.com/google-adds-author-url-property-to-uniquely-identify-authors-of-articles-351131
7. Changes to HowTo and FAQ rich results — Google Search Central Blog (2023-08, amended 2023-09). https://developers.google.com/search/blog/2023/08/howto-faq-changes
8. Google ends FAQ rich results for all sites — TechWyse (2026). https://www.techwyse.com/news/ai-search/google-faq-rich-results-deprecated-2026
9. Google FAQ schema rich result deprecation — inblog. https://inblog.ai/blog/google-faq-schema-rich-result-deprecation
12. Microsoft Bing / Copilot use schema for its LLMs — Search Engine Land (2025-03). https://searchengineland.com/microsoft-bing-copilot-use-schema-for-its-llms-453455
13. Microsoft confirms schema helps its LLMs — Search Engine Roundtable (2025-03). https://www.seroundtable.com/schema-llms-copilot-bing-microsoft-39093.html
14. Bing Webmaster Blog (2025–2026 posts on AI search, structured content, IndexNow). https://blogs.bing.com/webmaster/feed/
15. FAQ schema for AI answers — ZipTie. https://ziptie.dev/blog/faq-schema-for-ai-answers
16. FAQ schema and AI citations — DEV Community. https://dev.to/watsonfoglift/faq-schema-gets-you-27x-more-ai-citations-but-not-for-the-reason-you-think-5a04
17. Simplifying breadcrumbs — Google Search Central Blog (2025-01). https://developers.google.cn/search/blog/2025/01/simplifying-breadcrumbs
18. Google removes breadcrumb from mobile results — Search Engine Roundtable. https://seroundtable.com/google-search-drops-breadcrumb-from-mobile-search-results-38796.html
19. Simplifying the search results page — Google Search Central Blog (2025-06). https://developers.google.com/search/blog/2025/06/simplifying-search-results
20. An update on simplifying the search results page — Google Search Central Blog (2025-11). https://developers.google.com/search/blog/2025/11/update-on-our-efforts
21. Creating helpful, reliable, people-first content — Google Search Central. https://developers.google.com/search/docs/fundamentals/creating-helpful-content
22. Google Search's guidance about AI-generated content — Google Search Central Blog (2023-02). https://developers.google.com/search/blog/2023/02/google-search-and-ai-content
23. E-A-T gets an extra E for Experience — Google Search Central Blog (2022-12). https://developers.google.com/search/blog/2022/12/google-raters-guidelines-e-e-a-t
25. Google quality rater guidelines update (2025-09) — SEO-Kreativ. https://www.seo-kreativ.de/en/blog/google-quality-raters-update_9-25/
26. Rater guidelines and AI content — PPC Land. https://ppc.land/google-updates-quality-rater-guidelines-with-ai-content-evaluation-criteria/
27. ProfilePage structured data — Google Search Central. https://developers.google.com/search/docs/appearance/structured-data/profile-page
29. Link best practices for Google — Google Search Central. https://developers.google.com/search/docs/crawling-indexing/links-crawlable
30. Google publishes new link best practices — Search Engine Land. https://searchengineland.com/google-publishes-new-link-best-practices-393169
31. Google on choosing the best anchor text — Search Engine Journal. https://www.searchenginejournal.com/google-on-choosing-the-best-anchor-text/
32. SEO Starter Guide — Google Search Central. https://developers.google.com/search/docs/fundamentals/seo-starter-guide
33. Topic cluster — Conductor Academy. https://www.conductor.com/academy/glossary/topic-cluster/
34. Influencing title links — Google Search Central. https://developers.google.com/search/docs/appearance/title-link
35. How Google generates titles — Google Search Central Blog (2021-09). https://developers.google.com/search/blog/2021/09/more-info-about-titles
36. Meta descriptions and snippets — Google Search Central. https://developers.google.com/search/docs/appearance/snippet
37. AI features and your website — Google Search Central. https://developers.google.com/search/docs/appearance/ai-features
38. Images in link shares — Meta for Developers. https://developers.facebook.com/docs/sharing/webmasters/images
40. Twitter cards and X sharing — The SEO Framework KB. https://kb.theseoframework.com/kb/twitter-cards-and-x-sharing/
42. Byline dates — Google Search Central. https://developers.google.com/search/docs/appearance/publication-dates
43. Help Google Search know the best date for your page — Google Search Central Blog (2019-03). https://developers.google.com/search/blog/2019/03/help-google-search-know-best-date-for
44. Build and submit a sitemap — Google Search Central. https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
45. The sitemaps ping endpoint is going away — Google Search Central Blog (2023-06). https://developers.google.com/search/blog/2023/06/sitemaps-lastmod-ping
46. May 2023 SEO office hours — Google Search Central. https://developers.google.com/search/help/office-hours/2023/may
48. IndexNow — Wikipedia. https://en.wikipedia.org/wiki/IndexNow
49. IndexNow specification page. https://specification.website/spec/seo/indexnow/
50. IndexNow co-sharing between Bing and Yandex — Search Engine Land (2022). https://searchengineland.com/indexnow-now-officially-co-sharing-urls-between-microsoft-bing-and-yandex-378562
51. Introducing AI Performance in Bing Webmaster Tools — Bing Webmaster Blog (2026-02). https://blogs.bing.com/webmaster/February-2026/Introducing-AI-Performance-in-Bing-Webmaster-Tools-Public-Preview
52. IndexNow for Shopping and Ads — Bing Webmaster Blog (2025-05). https://blogs.bing.com/webmaster/May-2025/IndexNow-Enables-Faster-and-More-Reliable-Updates-for-Shopping-and-Ads
55. Optimizing your website for generative AI features — Google Search Central (2026-05). https://developers.google.com/search/docs/fundamentals/ai-optimization-guide
56. Normal SEO works for AI Overviews; llms.txt won't be used — Search Engine Land. https://searchengineland.com/google-says-normal-seo-works-for-ranking-in-ai-overviews-and-llms-txt-wont-be-used-459422
59. Does llms.txt work? — Optimizely. https://www.optimizely.com/field-notes/articles/does-llms-txt-work/
60. llms.txt: 844,000 implementations, zero confirmed AI usage — BlckAlpaca. https://blckalpaca.at/en/knowledge-base/seo-geo/geo-generative-engine-optimization/llmstxt-844000-implementations-zero-confirmed-ai-usage
62. Search Generative AI performance reports in Search Console — Google Search Central Blog (2026-06). https://developers.google.com/search/blog/2026/06/gen-ai-performance-reports
63. ChatGPT citations content study — Search Engine Land. https://searchengineland.com/chatgpt-citations-content-study-469483
64. The science of how AI pays attention — Search Engine Journal. https://www.searchenginejournal.com/the-science-of-how-ai-pays-attention/
65. GEO: Generative Engine Optimization — Aggarwal et al., arXiv 2311.09735 (KDD 2024). https://arxiv.org/pdf/2311.09735v1.pdf
67. Best content formats for AI citations — Rank4AI. https://www.rank4ai.co.uk/research/rankings/best-content-formats-for-ai-citations/
68. What gets cited by ChatGPT, Claude, Gemini and Perplexity — QuickSEO. https://quickseo.ai/blog/ai-citation-patterns-chatgpt-claude-gemini-perplexity
69. Which sources do AI engines cite? — Agenzy (2026). https://www.agenzy.lt/blog/which-sources-ai-engines-cite-2026
70. Overview of OpenAI crawlers — OpenAI. https://developers.openai.com/docs/bots
71. Image SEO best practices — Google Search Central. https://developers.google.com/search/docs/appearance/google-images
72. Filenames and file types — Google developer documentation style guide. https://developers.google.com/style/filenames
73. Mobile-first indexing best practices — Google Search Central. https://developers.google.com/search/docs/crawling-indexing/mobile/mobile-sites-mobile-first-indexing
74. Diagrams, figures and other images — Google developer documentation style guide. https://developers.google.com/style/images
75. Write helpful alt text — Google Technical Writing. https://developers.google.com/tech-writing/accessibility/self-study/write-alt-text
76. Web Vitals — web.dev. https://web.dev/articles/vitals
77. Core Web Vitals and Google search results — Google Search Central. https://developers.google.com/search/docs/appearance/core-web-vitals
78. INP becomes a Core Web Vital on March 12 — web.dev. https://web.dev/blog/inp-cwv-march-12
79. INP is officially a Core Web Vital — web.dev. https://web.dev/blog/inp-cwv-launch
80. Understanding page experience — Google Search Central. https://developers.google.com/search/docs/appearance/page-experience
81. The role of page experience in creating helpful content — Google Search Central Blog (2023-04). https://developers.google.com/search/blog/2023/04/page-experience-in-search
82. Optimize resource loading with the Fetch Priority API — web.dev. https://web.dev/articles/fetch-priority
83. Optimize Largest Contentful Paint — web.dev. https://web.dev/articles/optimize-lcp
84. The most effective ways to improve Core Web Vitals — web.dev. https://web.dev/articles/top-cwv
85. Google to no longer support FAQ rich results — Search Engine Land (2026). https://searchengineland.com/google-to-no-longer-support-faq-rich-results-476957
86. Google kills FAQ rich results — PPC Land (2026). https://ppc.land/google-kills-faq-rich-results-what-seos-saw-coming-since-2019/

(The numbering keeps the research notes' numbers; sources the notes held
but this document doesn't use are left out.)
