import { describe, expect, it } from "vitest";
import {
  PINNED_CARDS_MAX,
  SOCIAL_PLATFORMS,
  pinnedCardIdsSchema,
  profileUpdateSchema,
} from "@/lib/auth/schemas";

// ---------------------------------------------------------------------------
// profileUpdateSchema — social URL host-gating, accent color regex, empty
// strings normalized to undefined so the DB stores null.
// ---------------------------------------------------------------------------

const validBase = {
  username: "forge_master",
  display_name: "Forge Master",
  bio: "",
  website_url: "",
};

describe("profileUpdateSchema — socials", () => {
  it("accepts a twitter URL on twitter.com OR x.com", () => {
    for (const url of [
      "https://twitter.com/spellwright",
      "https://x.com/spellwright",
      "https://www.x.com/spellwright",
    ]) {
      const r = profileUpdateSchema.safeParse({
        ...validBase,
        twitter_url: url,
      });
      expect(r.success, `failed: ${url}`).toBe(true);
    }
  });

  it("rejects a twitter URL on the wrong host", () => {
    const r = profileUpdateSchema.safeParse({
      ...validBase,
      twitter_url: "https://facebook.com/spellwright",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.path).toContain("twitter_url");
    }
  });

  it("rejects http:// social URLs (no mixed content)", () => {
    const r = profileUpdateSchema.safeParse({
      ...validBase,
      bluesky_url: "http://bsky.app/profile/test",
    });
    expect(r.success).toBe(false);
  });

  it("treats an empty social URL as undefined (no validation error)", () => {
    const r = profileUpdateSchema.safeParse({
      ...validBase,
      youtube_url: "",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.youtube_url).toBeUndefined();
  });

  it("validates each platform's host list", () => {
    // Spot-check: every platform key in SOCIAL_PLATFORMS must reject a
    // URL on a host that doesn't belong to it. This guards against a
    // schema edit that accidentally widens a platform's host whitelist.
    for (const platform of SOCIAL_PLATFORMS) {
      const r = profileUpdateSchema.safeParse({
        ...validBase,
        [platform.key]: "https://wrong-platform.example/handle",
      });
      expect(
        r.success,
        `${platform.key} unexpectedly accepted a wrong-host URL`,
      ).toBe(false);
    }
  });
});

describe("profileUpdateSchema — accent color", () => {
  it("accepts a #RRGGBB hex", () => {
    const r = profileUpdateSchema.safeParse({
      ...validBase,
      accent_color: "#d4af37",
    });
    expect(r.success).toBe(true);
  });

  it("rejects non-hex accent color values", () => {
    for (const v of ["d4af37", "#fff", "rgb(0,0,0)", "#GGGGGG", "#zzzzzz"]) {
      const r = profileUpdateSchema.safeParse({
        ...validBase,
        accent_color: v,
      });
      expect(r.success, `should reject: ${v}`).toBe(false);
    }
  });

  it("treats an empty accent color as undefined", () => {
    const r = profileUpdateSchema.safeParse({
      ...validBase,
      accent_color: "",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.accent_color).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// pinnedCardIdsSchema — UUID format, max-3 limit, uniqueness.
// ---------------------------------------------------------------------------

describe("pinnedCardIdsSchema", () => {
  const uuid = (n: number) =>
    `00000000-0000-0000-0000-00000000000${n}`.slice(0, 36);

  it("accepts 0 to PINNED_CARDS_MAX unique UUIDs", () => {
    for (let n = 0; n <= PINNED_CARDS_MAX; n++) {
      const ids = Array.from({ length: n }, (_, i) => uuid(i));
      const r = pinnedCardIdsSchema.safeParse(ids);
      expect(r.success, `length ${n} should pass`).toBe(true);
    }
  });

  it(`rejects more than ${PINNED_CARDS_MAX} cards`, () => {
    const ids = Array.from({ length: PINNED_CARDS_MAX + 1 }, (_, i) =>
      uuid(i),
    );
    const r = pinnedCardIdsSchema.safeParse(ids);
    expect(r.success).toBe(false);
  });

  it("rejects duplicate ids", () => {
    const r = pinnedCardIdsSchema.safeParse([uuid(1), uuid(1)]);
    expect(r.success).toBe(false);
  });

  it("rejects ids that aren't UUIDs", () => {
    const r = pinnedCardIdsSchema.safeParse(["not-a-uuid"]);
    expect(r.success).toBe(false);
  });
});
