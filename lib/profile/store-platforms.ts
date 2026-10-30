import { z } from "zod";
import { containsProfanity } from "@/lib/moderation/profanity";
import { hostMatches, parseHttpsLink, PROFILE_LINK_URL_MAX } from "@/lib/profile/https-link";
import { STRONG_LANGUAGE_PROFILE_TEXT } from "@/lib/profile/link-kinds";

// ---------------------------------------------------------------------------
// A profile's STORE cards (migration 0153, `profile_stores`): where a
// creator sells cards — the prominent "Visit store" cards on their profile.
// ONE registry, read by the Settings editor, the shared zod schema, the
// profile's store card and the migration's `platform` CHECK
// (tests/unit/db/profile-links-migration.test.ts).
//
// Every platform is https + a HOST allow-list (a subdomain of a listed host
// passes; eBay's regional sites are listed one by one) and, where the
// platform has one storefront URL shape, a path test. Only platforms where
// an individual has a storefront of their own are here — Card Kingdom is
// not (people sell TO it through its buylist, they have no page there).
// Logos: none of these marks is drawn — the card prints the platform's NAME
// as plain text beside a neutral icon (brand rules, sources and the
// decision: docs/research/profiles-and-stores-2026-10.md).
//
// The title a maker gives a store card is public, prominent text: strong
// language (lib/moderation/profanity.ts) is refused with a field error —
// there is no "private" for a profile to fall back to.
// ---------------------------------------------------------------------------

export type StorePlatform = {
  key: string;
  label: string;
  hosts: readonly string[];
  paths?: readonly RegExp[];
  /** A shop may also be its own subdomain's home page
   *  (`yourshop.etsy.com`) — any path test aside. */
  shopSubdomains?: boolean;
  placeholder: string;
  /** One line under the platform's name on the card when no title is set. */
  blurb: string;
};

/** eBay's own country sites (ebay.com covers every subdomain of it). */
const EBAY_HOSTS = [
  "ebay.com",
  "ebay.co.uk",
  "ebay.ca",
  "ebay.com.au",
  "ebay.de",
  "ebay.fr",
  "ebay.it",
  "ebay.es",
  "ebay.ie",
  "ebay.nl",
  "ebay.at",
  "ebay.ch",
  "ebay.be",
  "ebay.pl",
] as const;

export const STORE_PLATFORMS = [
  {
    key: "tcgplayer",
    label: "TCGplayer",
    hosts: ["tcgplayer.com"],
    placeholder: "https://www.tcgplayer.com/search/magic/product?seller=…",
    blurb: "Singles from my TCGplayer storefront",
  },
  {
    key: "ebay",
    label: "eBay",
    hosts: EBAY_HOSTS,
    paths: [/^\/str\/[^/]+\/?$/i, /^\/usr\/[^/]+\/?$/i],
    placeholder: "https://www.ebay.com/str/your-store",
    blurb: "Auctions and Buy It Now on eBay",
  },
  {
    key: "whatnot",
    label: "Whatnot",
    hosts: ["whatnot.com"],
    paths: [/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?user\/[^/]+\/?$/i],
    placeholder: "https://www.whatnot.com/user/your-name",
    blurb: "Live breaks and auctions on Whatnot",
  },
  {
    key: "cardmarket",
    label: "Cardmarket",
    hosts: ["cardmarket.com"],
    paths: [/^\/[a-z]{2}\/magic\/users\/[^/]+(?:\/offers\/singles)?\/?$/i],
    placeholder: "https://www.cardmarket.com/en/Magic/Users/your-name",
    blurb: "Singles on Cardmarket (Europe)",
  },
  {
    key: "cardtrader",
    label: "CardTrader",
    hosts: ["cardtrader.com"],
    placeholder: "https://www.cardtrader.com/…",
    blurb: "My shop on CardTrader",
  },
  {
    key: "manapool",
    label: "Mana Pool",
    hosts: ["manapool.com"],
    paths: [/^\/shop\/[^/]+\/?$/i],
    placeholder: "https://manapool.com/shop/your-name",
    blurb: "Singles on Mana Pool",
  },
  {
    key: "mercari",
    label: "Mercari",
    hosts: ["mercari.com"],
    // mercari.com/u/<id>; Mercari Japan jp.mercari.com/user/profile/<id>.
    paths: [/^\/(?:[a-z]{2}\/)?u\/[^/]+\/?$/i, /^\/user\/profile\/[^/]+\/?$/i],
    placeholder: "https://www.mercari.com/u/123456789/",
    blurb: "Listings on Mercari",
  },
  {
    key: "etsy",
    label: "Etsy",
    hosts: ["etsy.com"],
    paths: [/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?shop\/[^/]+\/?$/i],
    shopSubdomains: true,
    placeholder: "https://www.etsy.com/shop/YourShop",
    blurb: "Alters, playmats and art prints on Etsy",
  },
  {
    key: "facebook",
    label: "Facebook",
    hosts: ["facebook.com"],
    paths: [/^\/marketplace\/profile\/\d+\/?$/i, /^\/groups\/[^/]+\/?$/i, /^\/[^/]+\/?$/i],
    placeholder: "https://www.facebook.com/marketplace/profile/123…",
    blurb: "Marketplace listings and my trading group",
  },
  {
    key: "website",
    label: "Online shop",
    hosts: [],
    placeholder: "https://shop.your-store.example",
    blurb: "My own online store",
  },
] as const satisfies readonly StorePlatform[];

export type StorePlatformKey = (typeof STORE_PLATFORMS)[number]["key"];

export const STORE_PLATFORM_KEYS = STORE_PLATFORMS.map((p) => p.key) as readonly StorePlatformKey[];

const BY_KEY: ReadonlyMap<string, StorePlatform> = new Map(STORE_PLATFORMS.map((p) => [p.key, p]));

export function storePlatformOf(key: string): StorePlatform | null {
  return BY_KEY.get(key) ?? null;
}

/** How many store cards a profile holds (the migration's trigger agrees). */
export const PROFILE_STORES_MAX = 4;
export const STORE_TITLE_MAX = 60;

/** `yourshop.etsy.com/` — a subdomain (never www) of the platform's host, at
 *  its home page. */
function isShopSubdomain(platform: StorePlatform, url: URL): boolean {
  if (!platform.shopSubdomains || (url.pathname !== "/" && url.pathname !== "")) return false;
  const host = url.hostname.toLowerCase();
  return platform.hosts.some(
    (base) => host.endsWith(`.${base}`) && !["www", "m"].includes(host.slice(0, -base.length - 1)),
  );
}

/** Why `url` can't be a store on `platform`, or null when it can. */
export function storeUrlError(platform: StorePlatform, raw: string): string | null {
  const url = parseHttpsLink(raw);
  if (!url) return "Enter a full https:// link to your store.";
  if (platform.hosts.length > 0 && !hostMatches(url.hostname, platform.hosts)) {
    return `That isn't a ${platform.label} link.`;
  }
  if (platform.paths && !platform.paths.some((re) => re.test(url.pathname)) && !isShopSubdomain(platform, url)) {
    return `Paste your ${platform.label} store link, like ${platform.placeholder}.`;
  }
  return null;
}

export const profileStoreSchema = z
  .object({
    platform: z.enum(STORE_PLATFORM_KEYS as unknown as [StorePlatformKey, ...StorePlatformKey[]], {
      error: "Pick where your store is.",
    }),
    url: z.string().trim().max(PROFILE_LINK_URL_MAX, "Links must be 2048 characters or fewer."),
    title: z
      .string()
      .trim()
      .max(STORE_TITLE_MAX, `Titles are ${STORE_TITLE_MAX} characters or fewer.`)
      .refine((v) => !containsProfanity(v), STRONG_LANGUAGE_PROFILE_TEXT)
      .optional()
      .transform((v) => (v ? v : undefined)),
  })
  .superRefine((value, ctx) => {
    const platform = storePlatformOf(value.platform);
    if (!platform) return;
    const error = storeUrlError(platform, value.url);
    if (error) ctx.addIssue({ code: "custom", path: ["url"], message: error });
  });

export const profileStoresSchema = z
  .array(profileStoreSchema)
  .max(PROFILE_STORES_MAX, `Add up to ${PROFILE_STORES_MAX} stores.`)
  .superRefine((stores, ctx) => {
    const seen = new Set<string>();
    stores.forEach((store, i) => {
      const key = store.url.trim().toLowerCase().replace(/\/$/, "");
      if (seen.has(key)) {
        ctx.addIssue({ code: "custom", path: [i, "url"], message: "This store is already in the list." });
      }
      seen.add(key);
    });
  });

export type ProfileStoreInput = z.infer<typeof profileStoreSchema>;

export type ProfileStore = {
  id: string;
  platform: StorePlatformKey;
  url: string;
  title: string | null;
  position: number;
};

/** The rows a profile may DRAW (see drawableProfileLinks): a known platform,
 *  a URL that passes, a title with no strong language. */
export function drawableProfileStores<T extends { platform: string; url: string; title: string | null }>(
  rows: readonly T[],
): T[] {
  return rows.filter((row) => {
    const platform = storePlatformOf(row.platform);
    return platform !== null && storeUrlError(platform, row.url) === null && !containsProfanity(row.title);
  });
}

/** The `rel` of every store and link a USER wrote (Google's user-generated
 *  content hint; no referrer-borne window access). */
export const USER_LINK_REL = "nofollow noopener ugc";
