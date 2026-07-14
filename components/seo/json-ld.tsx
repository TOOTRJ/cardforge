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
