import { describe, expect, it } from "vitest";
import { buildProfileJsonLd } from "@/lib/profile/json-ld";
import type { ProfileWithStats } from "@/lib/cards/queries";

// The profile's Person JSON-LD names every link its creator vouches for in
// `sameAs` — the website, the column socials and the 0153 links — once each.

const profile = {
  id: "11111111-1111-4111-8111-111111111111",
  username: "forge",
  display_name: "Forge",
  bio: null,
  avatar_url: null,
  website_url: "https://forge.example/",
  twitter_url: "https://x.com/forge",
  bluesky_url: null,
  instagram_url: null,
  youtube_url: null,
  tiktok_url: null,
  discord_url: null,
  github_url: null,
  created_at: "2026-01-01T00:00:00.000Z",
  public_cards_count: 3,
} as unknown as ProfileWithStats;

describe("buildProfileJsonLd", () => {
  it("adds the extra links to sameAs, without repeats", () => {
    const ld = buildProfileJsonLd(profile, "Forge", [
      { url: "https://moxfield.com/users/forge" },
      { url: "https://x.com/forge" },
    ]);
    const person = ld.mainEntity as Record<string, unknown>;
    expect(person.sameAs).toEqual([
      "https://forge.example/",
      "https://x.com/forge",
      "https://moxfield.com/users/forge",
    ]);
  });

  it("leaves sameAs out when there is no link", () => {
    const ld = buildProfileJsonLd({ ...profile, website_url: null, twitter_url: null }, "Forge");
    expect((ld.mainEntity as Record<string, unknown>).sameAs).toBeUndefined();
  });
});
