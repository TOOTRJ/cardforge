import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  creditsForPackPriceId,
  priceIdForPack,
  priceIdForTier,
  tierForPriceId,
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
