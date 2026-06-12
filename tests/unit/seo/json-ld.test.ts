import { describe, expect, it } from "vitest";
import {
  breadcrumbJsonLd,
  ITEM_LIST_CAP,
  itemListJsonLd,
} from "@/components/seo/json-ld";
import { getSiteBaseUrl } from "@/lib/site-url";

const base = getSiteBaseUrl();

describe("breadcrumbJsonLd", () => {
  it("emits ordered ListItems with absolute URLs", () => {
    const schema = breadcrumbJsonLd([
      { name: "Home", path: "/" },
      { name: "Gallery", path: "/gallery" },
      { name: "Lightning Sprite", path: "/card/jester/lightning-sprite" },
    ]);

    expect(schema["@type"]).toBe("BreadcrumbList");
    const items = schema.itemListElement as Array<Record<string, unknown>>;
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      "@type": "ListItem",
      position: 1,
      name: "Home",
      item: `${base}/`,
    });
    expect(items[2]).toMatchObject({
      position: 3,
      item: `${base}/card/jester/lightning-sprite`,
    });
  });
});

describe("itemListJsonLd", () => {
  it("emits named ListItems with absolute URLs and a count", () => {
    const schema = itemListJsonLd({
      name: "Entries",
      items: [
        { name: "Card A", path: "/card/a/a" },
        { name: "Card B", path: "/card/b/b" },
      ],
    });

    expect(schema["@type"]).toBe("ItemList");
    expect(schema.numberOfItems).toBe(2);
    const items = schema.itemListElement as Array<Record<string, unknown>>;
    expect(items[1]).toMatchObject({
      "@type": "ListItem",
      position: 2,
      name: "Card B",
      url: `${base}/card/b/b`,
    });
  });

  it(`caps the list at ${ITEM_LIST_CAP} entries`, () => {
    const schema = itemListJsonLd({
      name: "Big list",
      items: Array.from({ length: ITEM_LIST_CAP + 10 }, (_, i) => ({
        name: `Card ${i}`,
        path: `/card/u/${i}`,
      })),
    });
    expect(schema.numberOfItems).toBe(ITEM_LIST_CAP);
    expect(schema.itemListElement).toHaveLength(ITEM_LIST_CAP);
  });

  it("serializes to valid JSON round-trip", () => {
    const schema = itemListJsonLd({
      name: 'Quotes "and" <scripts>',
      items: [{ name: "A & B", path: "/card/x/y" }],
    });
    expect(JSON.parse(JSON.stringify(schema))).toEqual(schema);
  });
});
