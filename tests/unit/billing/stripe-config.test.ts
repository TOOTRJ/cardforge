import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  creditsForPackPriceId,
  priceIdForPack,
  priceIdForTier,
  tierForAmount,
  tierForPrice,
  tierForPriceId,
  tierForProduct,
} from "@/lib/stripe/config";

const ENV_KEYS = [
  "STRIPE_PRICE_PLUS_MONTHLY",
  "STRIPE_PRICE_PLUS_ANNUAL",
  "STRIPE_PRICE_PRO_MONTHLY",
  "STRIPE_PRICE_PRO_ANNUAL",
  "STRIPE_PRICE_PACK_SMALL",
  "STRIPE_PRICE_PACK_LARGE",
] as const;

describe("stripe price ↔ plan mapping", () => {
  beforeEach(() => {
    process.env.STRIPE_PRICE_PLUS_MONTHLY = "price_plus_m";
    process.env.STRIPE_PRICE_PLUS_ANNUAL = "price_plus_y";
    process.env.STRIPE_PRICE_PRO_MONTHLY = "price_pro_m";
    process.env.STRIPE_PRICE_PRO_ANNUAL = "price_pro_y";
    process.env.STRIPE_PRICE_PACK_SMALL = "price_pack_s";
    process.env.STRIPE_PRICE_PACK_LARGE = "price_pack_l";
  });

  afterEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
  });

  it("maps monthly AND annual subscription price ids back to a tier", () => {
    expect(tierForPriceId("price_plus_m")).toBe("plus");
    expect(tierForPriceId("price_plus_y")).toBe("plus");
    expect(tierForPriceId("price_pro_m")).toBe("pro");
    expect(tierForPriceId("price_pro_y")).toBe("pro");
    expect(tierForPriceId("price_unknown")).toBeNull();
    expect(tierForPriceId(null)).toBeNull();
  });

  it("resolves the configured price id for a tier + period", () => {
    expect(priceIdForTier("plus")).toBe("price_plus_m"); // defaults to monthly
    expect(priceIdForTier("plus", "monthly")).toBe("price_plus_m");
    expect(priceIdForTier("plus", "annual")).toBe("price_plus_y");
    expect(priceIdForTier("pro", "annual")).toBe("price_pro_y");
  });

  it("maps pack price ids to a credit amount", () => {
    const small = creditsForPackPriceId("price_pack_s");
    const large = creditsForPackPriceId("price_pack_l");
    expect(small).toBeGreaterThan(0);
    expect(large).toBeGreaterThan(small ?? 0);
    expect(creditsForPackPriceId("nope")).toBeNull();
    expect(priceIdForPack("large")).toBe("price_pack_l");
  });

  it("returns undefined when a price env var is unset", () => {
    delete process.env.STRIPE_PRICE_PLUS_ANNUAL;
    expect(priceIdForTier("plus", "annual")).toBeUndefined();
  });
});

describe("tierForPrice (beyond the env ids)", () => {
  beforeEach(() => {
    process.env.STRIPE_PRICE_PLUS_MONTHLY = "price_plus_m";
    process.env.STRIPE_PRICE_PRO_MONTHLY = "price_pro_m";
  });
  afterEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
  });

  it("env id wins when configured", () => {
    expect(tierForPrice({ id: "price_pro_m", nickname: "Plus (old)" })).toBe("pro");
  });

  it("reads price metadata, lookup keys, nicknames, and the expanded product", () => {
    expect(tierForPrice({ id: "x", metadata: { tier: "plus" } })).toBe("plus");
    expect(tierForPrice({ id: "x", lookup_key: "pipglyph_pro_monthly" })).toBe("pro");
    expect(tierForPrice({ id: "x", nickname: "Plus — monthly" })).toBe("plus");
    expect(tierForPrice({ id: "x", product: { id: "p", name: "PipGlyph Pro" } })).toBe("pro");
    expect(tierForPrice({ id: "x", product: { id: "p", metadata: { plan: "PLUS" } } })).toBe("plus");
    // Word-bounded: "Protection" is not "Pro".
    expect(tierForPrice({ id: "x", nickname: "Protection plan" })).toBeNull();
  });

  it("matches recurring amounts against the plan catalog (monthly and annual)", () => {
    expect(tierForAmount(600, "month")).toBe("plus");
    expect(tierForAmount(1500, "month")).toBe("pro");
    expect(tierForAmount(6000, "year")).toBe("plus");
    expect(tierForAmount(15000, "year")).toBe("pro");
    expect(tierForAmount(1500, "year")).toBeNull();
    expect(tierForAmount(999, "month")).toBeNull();
    expect(tierForPrice({ id: "x", unit_amount: 1500, recurring: { interval: "month" } })).toBe("pro");
  });

  it("returns null for a truly unknown price and never throws on a null input", () => {
    expect(tierForPrice({ id: "x", unit_amount: 4200, recurring: { interval: "month" } })).toBeNull();
    expect(tierForPrice(null)).toBeNull();
    expect(tierForProduct({ id: "p", name: "Pro", deleted: true })).toBeNull();
  });
});
