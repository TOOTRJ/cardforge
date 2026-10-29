import { getSiteBaseUrl } from "@/lib/site-url";

// ---------------------------------------------------------------------------
// JSON-LD structured data helpers.
//
// Search engines and AI answer engines (Google, ChatGPT, Perplexity) read
// these blocks to understand page relationships — breadcrumbs give them the
// site hierarchy, ItemList tells them a page is a ranked collection. Builders
// emit absolute URLs (schema.org consumers don't resolve relative ones).
// ---------------------------------------------------------------------------

/** Serialize a schema.org object for safe inlining inside a <script> tag.
 *  Plain JSON.stringify does NOT escape `<`, so a user-controlled string
 *  containing `</script>` (a card title, flavor text, or display name) would
 *  break out of the JSON-LD block — the canonical JSON-LD XSS. Escaping the
 *  HTML-significant characters and the two JS line terminators (which are
 *  legal in JSON strings but break inline script parsing) closes it. */
export function serializeJsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** Renders a schema.org object as an inline JSON-LD script tag. */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}

export type CrumbItem = {
  name: string;
  /** Site-relative path, e.g. "/gallery". */
  path: string;
};

export function breadcrumbJsonLd(items: CrumbItem[]): Record<string, unknown> {
  const base = getSiteBaseUrl();
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: `${base}${item.path}`,
    })),
  };
}

export type ListEntry = {
  name: string;
  /** Site-relative path to the item's canonical page. */
  path: string;
};

/** Max entries emitted per ItemList — enough for a full grid page without
 *  bloating the HTML on long lists. */
export const ITEM_LIST_CAP = 24;

export function itemListJsonLd({
  name,
  items,
}: {
  name: string;
  items: ListEntry[];
}): Record<string, unknown> {
  const base = getSiteBaseUrl();
  const capped = items.slice(0, ITEM_LIST_CAP);
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name,
    numberOfItems: capped.length,
    itemListElement: capped.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      url: `${base}${item.path}`,
    })),
  };
}

/** CollectionPage structured data — a page whose job is to gather other
 *  pages (the /learn hub, a /learn/<category> shelf). `items` become its
 *  mainEntity ItemList (same cap as itemListJsonLd). */
export function collectionPageJsonLd({
  name,
  description,
  path,
  items,
}: {
  name: string;
  description: string;
  /** Site-relative path of the collection page itself. */
  path: string;
  items: ListEntry[];
}): Record<string, unknown> {
  const base = getSiteBaseUrl();
  // Nested inside the page, the list carries no @context of its own.
  const list = itemListJsonLd({ name, items });
  delete list["@context"];
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name,
    description,
    url: `${base}${path}`,
    isPartOf: { "@type": "WebSite", name: "PipGlyph", url: base },
    mainEntity: list,
  };
}

export type FaqItem = { q: string; a: string };

/** FAQPage structured data — the Q&A becomes eligible for rich results. Pass
 *  the same questions the page renders visibly (Google requires the FAQ to
 *  be on the page, not JSON-LD only). */
export function faqJsonLd(items: FaqItem[]): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
}

export type DefinedTermEntry = {
  /** The term's anchor on the set's page (`#<id>`). */
  id: string;
  name: string;
  description: string;
  alternateNames?: readonly string[];
};

/** DefinedTermSet structured data — a glossary page. Each term is a
 *  DefinedTerm whose url is its anchor on the page, so an answer engine can
 *  cite the one definition rather than the whole page. Pass the same terms
 *  and words the page renders. */
export function definedTermSetJsonLd({
  name,
  description,
  path,
  terms,
}: {
  name: string;
  description: string;
  /** Site-relative path of the glossary page. */
  path: string;
  terms: readonly DefinedTermEntry[];
}): Record<string, unknown> {
  const url = `${getSiteBaseUrl()}${path}`;
  return {
    "@context": "https://schema.org",
    "@type": "DefinedTermSet",
    "@id": url,
    name,
    description,
    url,
    hasDefinedTerm: terms.map((term) => ({
      "@type": "DefinedTerm",
      "@id": `${url}#${term.id}`,
      name: term.name,
      description: term.description,
      url: `${url}#${term.id}`,
      ...(term.alternateNames?.length ? { alternateName: [...term.alternateNames] } : {}),
      inDefinedTermSet: { "@id": url },
    })),
  };
}
