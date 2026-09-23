import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPriceCache,
  packLookupKey,
  resolvePriceId,
  tierLookupKey,
  type PriceLister,
} from "@/lib/stripe/prices";

// ---------------------------------------------------------------------------
// Price resolution by lookup key — the fix for the 2026-09-22 outage where a
// STRIPE_PRICE_* env var held an id the live catalog doesn't have and every
// credit-pack checkout failed with resource_missing.
// ---------------------------------------------------------------------------

function stripeWith(catalog: Record<string, string>, opts: { throws?: boolean } = {}) {
  const list = vi.fn(async ({ lookup_keys }: { lookup_keys: string[] }) => {
    if (opts.throws) throw new Error("stripe down");
    const id = catalog[lookup_keys[0]!];
    return { data: id ? [{ id }] : [] };
  });
  return { stripe: { prices: { list } } as PriceLister, list };
}

beforeEach(() => {
  clearPriceCache();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  delete process.env.STRIPE_PRICE_PACK_SMALL;
  delete process.env.STRIPE_PRICE_PRO_ANNUAL;
  vi.restoreAllMocks();
});

describe("resolvePriceId", () => {
  it("maps plan keys to lookup keys", () => {
    expect(tierLookupKey("plus")).toBe("plus_monthly");
    expect(tierLookupKey("pro", "annual")).toBe("pro_annual");
    expect(packLookupKey("small")).toBe("pack_small");
  });

  it("uses the catalog's price for the lookup key and caches it", async () => {
    const { stripe, list } = stripeWith({ pack_small: "price_live_small" });
    expect(await resolvePriceId(stripe, "pack_small")).toBe("price_live_small");
    expect(await resolvePriceId(stripe, "pack_small")).toBe("price_live_small");
    expect(list).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledWith({ lookup_keys: ["pack_small"], active: true, limit: 1 });
  });

  it("the catalog wins over a stale STRIPE_PRICE_* env var — and says so", async () => {
    process.env.STRIPE_PRICE_PACK_SMALL = "price_test_small_pasted_by_mistake";
    const { stripe } = stripeWith({ pack_small: "price_live_small" });
    expect(await resolvePriceId(stripe, "pack_small")).toBe("price_live_small");
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("using the catalog"));
  });

  it("falls back to the env var when the catalog has no such lookup key, or when Stripe is unreachable", async () => {
    process.env.STRIPE_PRICE_PRO_ANNUAL = "price_env_pro_y";
    expect(await resolvePriceId(stripeWith({}).stripe, "pro_annual")).toBe("price_env_pro_y");
    expect(await resolvePriceId(stripeWith({}, { throws: true }).stripe, "pro_annual")).toBe("price_env_pro_y");
  });

  it("answers null (so the action can say the plan isn't available) when neither exists", async () => {
    expect(await resolvePriceId(stripeWith({}).stripe, "pro_annual")).toBeNull();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('No price for "pro_annual"'));
  });
});
