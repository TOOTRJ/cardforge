import { describe, expect, it } from "vitest";
import { attributionFromLanding, attributionSource, sanitizeAttribution } from "@/lib/analytics/attribution";

describe("signup attribution", () => {
  it("keeps the external referrer host and the three UTM fields, lowercased and bounded", () => {
    expect(
      attributionFromLanding({
        referrer: "https://www.reddit.com/r/magicTCG/comments/abc",
        search: "?utm_source=Reddit&utm_medium=social&utm_campaign=Proxy-Guide&utm_term=ignored",
        ownHost: "www.pipglyph.com",
      }),
    ).toEqual({ referrer: "reddit.com", utmSource: "reddit", utmMedium: "social", utmCampaign: "proxy-guide" });
  });

  it("ignores same-site referrers, bad URLs and unsafe values", () => {
    expect(attributionFromLanding({ referrer: "https://pipglyph.com/gallery", search: "", ownHost: "pipglyph.com" })).toEqual({});
    expect(attributionFromLanding({ referrer: "https://cdn.pipglyph.com/x", search: "", ownHost: "pipglyph.com" })).toEqual({});
    expect(attributionFromLanding({ referrer: "not a url", search: "?utm_source=<script>", ownHost: "pipglyph.com" })).toEqual({});
    expect(sanitizeAttribution({ utmSource: "x".repeat(200), referrer: 42 })).toEqual({ utmSource: "x".repeat(48) });
    expect(sanitizeAttribution(null)).toEqual({});
  });

  it("groups by utm_source, then referrer, else direct", () => {
    expect(attributionSource({ utmSource: "reddit", referrer: "google.com" })).toBe("reddit");
    expect(attributionSource({ referrer: "google.com" })).toBe("google.com");
    expect(attributionSource({})).toBe("direct");
  });
});
