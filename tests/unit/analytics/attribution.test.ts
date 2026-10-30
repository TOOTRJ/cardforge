import { describe, expect, it } from "vitest";
import {
  attributionFromLanding,
  attributionProps,
  attributionSource,
  mergeLandingAttribution,
  sanitizeAttribution,
} from "@/lib/analytics/attribution";

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

  it("a referral link's ?ref= rides the first-touch blob — only in its exact shape", () => {
    expect(attributionFromLanding({ referrer: "", search: "?ref=D0000003&utm_source=friend", ownHost: "pipglyph.com" })).toEqual({
      utmSource: "friend",
      ref: "d0000003",
    });
    expect(sanitizeAttribution({ ref: "javascript:alert(1)" })).toEqual({});
  });

  it("a later landing adds a referral code the tab doesn't hold yet — the FIRST code wins, the first touch stays", () => {
    const first = { referrer: "google.com" };
    expect(mergeLandingAttribution(first, { utmSource: "x", ref: "d0000003" })).toEqual({ referrer: "google.com", ref: "d0000003" });
    const held = { referrer: "google.com", ref: "d0000003" };
    expect(mergeLandingAttribution(held, { ref: "d0000004" })).toBe(held);
    expect(mergeLandingAttribution(first, { utmSource: "x" })).toBe(first);
    expect(mergeLandingAttribution(null, { ref: "d0000004" })).toEqual({ ref: "d0000004" });
  });

  it("the signup event's props never carry the code — only that the signup was referred", () => {
    expect(attributionProps({ utmSource: "x", ref: "d0000003" })).toEqual({ utmSource: "x", referred: true });
    expect(attributionProps({ utmSource: "x" })).toEqual({ utmSource: "x" });
  });
});
