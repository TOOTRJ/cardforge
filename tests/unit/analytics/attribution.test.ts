import { describe, expect, it, vi } from "vitest";
import {
  ATTRIBUTION_FIELDS,
  ATTRIBUTION_STORAGE_KEY,
  attributionFromLanding,
  attributionSource,
  attributionSurface,
  rememberSignupSurface,
  sanitizeAttribution,
  withSignupSurface,
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
});

describe("the create button a signup followed (owner 2026-11-04)", () => {
  it("keeps the first touch and sets the button pressed last", () => {
    const first = withSignupSurface({ referrer: "reddit.com", utmSource: "discord" }, "home_hero");
    expect(first).toEqual({ referrer: "reddit.com", utmSource: "discord", surface: "home_hero" });
    expect(withSignupSurface(first, "home_pulse")).toEqual({
      referrer: "reddit.com",
      utmSource: "discord",
      surface: "home_pulse",
    });
    expect(withSignupSurface(null, "header")).toEqual({ surface: "header" });
  });

  it("drops an unsafe surface and reads a missing one as none", () => {
    expect(sanitizeAttribution({ surface: "<script>" })).toEqual({});
    expect(attributionSurface({})).toBe("none");
    expect(attributionSurface({ surface: "home_final" })).toBe("home_final");
  });

  it("posts the surface from its own hidden field", () => {
    expect(ATTRIBUTION_FIELDS.surface).toBe("attr_surface");
  });

  it("remembers the button in the tab's attribution blob", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    store.set(ATTRIBUTION_STORAGE_KEY, JSON.stringify({ referrer: "google.com" }));
    rememberSignupSurface("home_hero");
    expect(JSON.parse(store.get(ATTRIBUTION_STORAGE_KEY)!)).toEqual({ referrer: "google.com", surface: "home_hero" });
    vi.unstubAllGlobals();
  });
});
