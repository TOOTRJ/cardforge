import { beforeEach, describe, expect, it, vi } from "vitest";
import { isAllowedServerImageFetchUrl, LEGACY_SUPABASE_HOSTS } from "@/lib/validation/card";

describe("isAllowedServerImageFetchUrl", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://auth.pipglyph.com");
  });
  it("allows the current storage host, every legacy storage host, and Scryfall", () => {
    expect(isAllowedServerImageFetchUrl("https://auth.pipglyph.com/storage/v1/object/public/card-art/x.png")).toBe(true);
    for (const host of LEGACY_SUPABASE_HOSTS) {
      expect(isAllowedServerImageFetchUrl(`https://${host}/storage/v1/object/public/card-art/x.png`)).toBe(true);
    }
    expect(isAllowedServerImageFetchUrl("https://cards.scryfall.io/art_crop/front/a/b.jpg")).toBe(true);
  });
  it("refuses arbitrary hosts, plain http, and metadata endpoints", () => {
    expect(isAllowedServerImageFetchUrl("https://evil.example/x.png")).toBe(false);
    expect(isAllowedServerImageFetchUrl("https://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isAllowedServerImageFetchUrl("http://zkwkisxoqdhdchqyjwdc.supabase.co/x.png")).toBe(false);
    expect(isAllowedServerImageFetchUrl("not a url")).toBe(false);
  });
});
