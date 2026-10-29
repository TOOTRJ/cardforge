import { describe, expect, it } from "vitest";
import {
  breadcrumbJsonLd,
  collectionPageJsonLd,
  ITEM_LIST_CAP,
  itemListJsonLd,
  serializeJsonLd,
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

describe("collectionPageJsonLd", () => {
  it("is a CollectionPage on the site with its entries as a nested ItemList", () => {
    const schema = collectionPageJsonLd({
      name: "Design guides",
      description: "Guides.",
      path: "/learn/design",
      items: [
        { name: "Guide A", path: "/articles/a" },
        { name: "Guide B", path: "/articles/b" },
      ],
    });
    expect(schema).toMatchObject({
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: "Design guides",
      description: "Guides.",
      url: `${base}/learn/design`,
      isPartOf: { "@type": "WebSite", name: "PipGlyph", url: base },
    });
    const list = schema.mainEntity as Record<string, unknown>;
    expect(list["@type"]).toBe("ItemList");
    expect(list["@context"]).toBeUndefined();
    expect(list.numberOfItems).toBe(2);
    expect((list.itemListElement as Array<Record<string, unknown>>)[1]).toMatchObject({
      position: 2,
      name: "Guide B",
      url: `${base}/articles/b`,
    });
  });
});

describe("serializeJsonLd (XSS hardening)", () => {
  it("escapes </script> so a malicious title can't break out of the tag", () => {
    const out = serializeJsonLd({
      name: "</script><script>alert(document.cookie)</script>",
    });
    // No raw angle brackets survive — the closing tag can't terminate the block.
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
    expect(out).not.toContain("</script>");
    expect(out).toContain("\\u003c");
    expect(out).toContain("\\u003e");
    // Still parses back to the original data (escapes are JSON unicode escapes).
    expect(JSON.parse(out)).toEqual({
      name: "</script><script>alert(document.cookie)</script>",
    });
  });

  it("escapes ampersands and the U+2028/U+2029 line terminators", () => {
    const out = serializeJsonLd({ name: "A & B C D" });
    expect(out).toContain("\\u0026");
    expect(out).toContain("\\u2028");
    expect(out).toContain("\\u2029");
    expect(out).not.toContain(" ");
    expect(out).not.toContain(" ");
    expect(JSON.parse(out)).toEqual({ name: "A & B C D" });
  });
});
