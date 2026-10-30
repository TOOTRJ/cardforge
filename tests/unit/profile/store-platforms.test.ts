import { describe, expect, it } from "vitest";
import {
  PROFILE_STORES_MAX,
  STORE_PLATFORMS,
  USER_LINK_REL,
  drawableProfileStores,
  profileStoreSchema,
  profileStoresSchema,
  storePlatformOf,
  storeUrlError,
} from "@/lib/profile/store-platforms";

// ---------------------------------------------------------------------------
// Store cards (migration 0153, lib/profile/store-platforms.ts): https + each
// platform's host allow-list (+ its storefront path), titles free of strong
// language, a cap, and the profile re-checks rows before drawing them.
// ---------------------------------------------------------------------------

const rot13 = (text: string) =>
  text.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));

const platform = (key: string) => {
  const found = storePlatformOf(key);
  if (!found) throw new Error(`no platform ${key}`);
  return found;
};

describe("store platforms", () => {
  it("have unique keys, and Card Kingdom is not one (no seller storefronts)", () => {
    const keys = STORE_PLATFORMS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).not.toContain("cardkingdom");
  });

  it("accept each platform's placeholder where it is a real URL", () => {
    for (const p of STORE_PLATFORMS) {
      if (p.placeholder.includes("…")) continue;
      expect(storeUrlError(p, p.placeholder), p.key).toBeNull();
    }
  });

  it("hold each store to its platform's hosts and storefront shape", () => {
    expect(storeUrlError(platform("ebay"), "https://www.ebay.com/str/forgecards")).toBeNull();
    expect(storeUrlError(platform("ebay"), "https://www.ebay.co.uk/usr/forgecards")).toBeNull();
    expect(storeUrlError(platform("ebay"), "https://www.ebay.de/str/forgecards")).toBeNull();
    expect(storeUrlError(platform("ebay"), "https://www.ebay.com/itm/12345")).toMatch(/store link/);
    expect(storeUrlError(platform("ebay"), "https://ebay.example/str/a")).toMatch(/isn't a eBay link/);
    expect(storeUrlError(platform("whatnot"), "https://www.whatnot.com/user/forge")).toBeNull();
    expect(storeUrlError(platform("tcgplayer"), "https://shop.tcgplayer.com/sellerfeedback/7df68429")).toBeNull();
    expect(storeUrlError(platform("cardmarket"), "https://www.cardmarket.com/de/Magic/Users/Forge")).toBeNull();
    expect(storeUrlError(platform("manapool"), "https://manapool.com/shop/forge")).toBeNull();
    expect(storeUrlError(platform("mercari"), "https://jp.mercari.com/user/profile/123")).toBeNull();
    expect(storeUrlError(platform("facebook"), "https://www.facebook.com/marketplace/profile/100012345")).toBeNull();
    expect(storeUrlError(platform("facebook"), "https://www.facebook.com/groups/mtgtrades")).toBeNull();
  });

  it("take an Etsy shop at /shop/ or on its own subdomain, never www's home", () => {
    expect(storeUrlError(platform("etsy"), "https://www.etsy.com/shop/ForgeAlters")).toBeNull();
    expect(storeUrlError(platform("etsy"), "https://forgealters.etsy.com/")).toBeNull();
    expect(storeUrlError(platform("etsy"), "https://www.etsy.com/")).not.toBeNull();
    expect(storeUrlError(platform("etsy"), "https://forgealters.etsy.com/listing/1")).not.toBeNull();
  });

  it("let 'Online shop' take any https page, and nothing else", () => {
    expect(storeUrlError(platform("website"), "https://shop.forge.example/")).toBeNull();
    expect(storeUrlError(platform("website"), "http://shop.forge.example/")).not.toBeNull();
    expect(storeUrlError(platform("website"), "javascript:alert(1)")).not.toBeNull();
  });

  it("refuse a title with strong language, keep a plain one", () => {
    const bad = profileStoreSchema.safeParse({
      platform: "ebay",
      url: "https://www.ebay.com/str/forge",
      title: `${rot13("fuvg")} deals`,
    });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0].path).toEqual(["title"]);
    const good = profileStoreSchema.safeParse({
      platform: "ebay",
      url: "https://www.ebay.com/str/forge",
      title: "Singles, sealed and Damnation foils",
    });
    expect(good.success).toBe(true);
  });

  it("cap the list", () => {
    const many = Array.from({ length: PROFILE_STORES_MAX + 1 }, (_, i) => ({
      platform: "website",
      url: `https://shop${i}.forge.example/`,
    }));
    expect(profileStoresSchema.safeParse(many).success).toBe(false);
    expect(profileStoresSchema.safeParse(many.slice(0, PROFILE_STORES_MAX)).success).toBe(true);
  });

  it("draw only rows that still pass (a row written past the action)", () => {
    const rows = [
      { platform: "ebay", url: "https://www.ebay.com/str/forge", title: null },
      { platform: "ebay", url: "https://evil.example/str/forge", title: null },
      { platform: "website", url: "https://shop.example/", title: `${rot13("phag")} store` },
      { platform: "nope", url: "https://shop.example/", title: null },
    ];
    expect(drawableProfileStores(rows)).toEqual([rows[0]]);
  });

  it("mark every user link nofollow, noopener and ugc", () => {
    expect(USER_LINK_REL.split(" ").sort()).toEqual(["nofollow", "noopener", "ugc"]);
  });
});
