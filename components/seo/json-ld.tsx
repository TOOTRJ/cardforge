import { getSiteBaseUrl } from "@/lib/site-url";

// ---------------------------------------------------------------------------
// JSON-LD structured data helpers.
//
// Search engines and AI answer engines (Google, ChatGPT, Perplexity) read
// these blocks to understand page relationships — breadcrumbs give them the
// site hierarchy, ItemList tells them a page is a ranked collection. Builders
// emit absolute URLs (schema.org consumers don't resolve relative ones).
// ---------------------------------------------------------------------------

/** Renders a schema.org object as an inline JSON-LD script tag. */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
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
