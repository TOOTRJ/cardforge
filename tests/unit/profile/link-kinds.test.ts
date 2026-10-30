import { describe, expect, it } from "vitest";
import {
  LINK_KINDS,
  PROFILE_LINKS_MAX,
  drawableProfileLinks,
  linkKindOf,
  linkUrlError,
  profileLinkName,
  profileLinkSchema,
  profileLinksSchema,
} from "@/lib/profile/link-kinds";
import { SOCIAL_PLATFORMS } from "@/lib/auth/schemas";
import { displayLink, hostMatches, parseHttpsLink } from "@/lib/profile/https-link";

// ---------------------------------------------------------------------------
// A profile's extra links (migration 0153, lib/profile/link-kinds.ts): every
// kind is https + its site's hosts (+ its profile path where it has one),
// "other" takes any https page and needs a name, labels refuse strong
// language, and the profile page re-checks rows before it draws them.
// ---------------------------------------------------------------------------

// The repo is public: the strong word under test is ROT13'd (as
// tests/unit/moderation/profanity.test.ts does).
const rot13 = (text: string) =>
  text.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));

const kind = (key: string) => {
  const found = linkKindOf(key);
  if (!found) throw new Error(`no kind ${key}`);
  return found;
};

describe("parseHttpsLink", () => {
  it("takes a plain https URL and nothing else", () => {
    expect(parseHttpsLink("https://moxfield.com/users/a")).not.toBeNull();
    expect(parseHttpsLink("  https://moxfield.com/users/a  ")).not.toBeNull();
    for (const bad of [
      "http://moxfield.com/users/a",
      "javascript:alert(1)",
      "JAVASCRIPT:alert(1)",
      "data:text/html,hi",
      "//moxfield.com/users/a",
      "moxfield.com/users/a",
      "https://user:pass@moxfield.com/",
      "https://moxfield.com:8443/users/a",
      "https://localhost/",
      "https://127.0.0.1/",
      "https://moxfield.com/users/a b",
      "https://moxfield.com/\u0000",
      `https://a.com/${"x".repeat(2050)}`,
      "",
    ]) {
      expect(parseHttpsLink(bad), bad).toBeNull();
    }
  });

  it("matches a host or its subdomains, never a look-alike", () => {
    expect(hostMatches("www.moxfield.com", ["moxfield.com"])).toBe(true);
    expect(hostMatches("moxfield.com", ["moxfield.com"])).toBe(true);
    expect(hostMatches("notmoxfield.com", ["moxfield.com"])).toBe(false);
    expect(hostMatches("moxfield.com.evil.example", ["moxfield.com"])).toBe(false);
  });

  it("prints a link without its scheme or trailing slash", () => {
    expect(displayLink("https://ko-fi.com/forge/")).toBe("ko-fi.com/forge");
  });
});

describe("link kinds", () => {
  it("have unique keys, and none duplicates a profile column", () => {
    const keys = LINK_KINDS.map((k) => k.key);
    expect(new Set(keys).size).toBe(keys.length);
    const columnLabels = SOCIAL_PLATFORMS.map((p) => p.label.toLowerCase());
    for (const k of LINK_KINDS) expect(columnLabels).not.toContain(k.label.toLowerCase());
  });

  it("accept each kind's own placeholder shape where it is a real URL", () => {
    for (const k of LINK_KINDS) {
      if (k.placeholder.includes("…")) continue;
      expect(linkUrlError(k, k.placeholder), k.key).toBeNull();
    }
  });

  it("hold each kind to its site", () => {
    expect(linkUrlError(kind("moxfield"), "https://www.moxfield.com/users/Forge")).toBeNull();
    expect(linkUrlError(kind("moxfield"), "https://moxfield.com/decks/abc")).toMatch(/profile link/);
    expect(linkUrlError(kind("moxfield"), "https://archidekt.com/u/forge")).toMatch(/isn't a Moxfield link/);
    expect(linkUrlError(kind("archidekt"), "https://archidekt.com/u/forge")).toBeNull();
    expect(linkUrlError(kind("twitch"), "https://m.twitch.tv/forge_master")).toBeNull();
    expect(linkUrlError(kind("twitch"), "https://twitch.tv/forge/videos")).not.toBeNull();
    expect(linkUrlError(kind("reddit"), "https://old.reddit.com/u/forge")).toBeNull();
    expect(linkUrlError(kind("reddit"), "https://www.reddit.com/r/magicTCG/")).toBeNull();
    expect(linkUrlError(kind("patreon"), "https://www.patreon.com/c/forge")).toBeNull();
    expect(linkUrlError(kind("kofi"), "https://ko-fi.com/forge")).toBeNull();
    expect(linkUrlError(kind("threads"), "https://www.threads.net/@forge")).toBeNull();
  });

  it("take Mastodon on any server, by its profile shape only", () => {
    expect(linkUrlError(kind("mastodon"), "https://mastodon.social/@forge")).toBeNull();
    expect(linkUrlError(kind("mastodon"), "https://mtg.town/@forge@mastodon.social")).toBeNull();
    expect(linkUrlError(kind("mastodon"), "https://mastodon.social/about")).not.toBeNull();
    expect(linkUrlError(kind("mastodon"), "http://mastodon.social/@forge")).not.toBeNull();
  });

  it("let 'other' take any https page, named", () => {
    expect(profileLinkSchema.safeParse({ kind: "other", url: "https://my.blog.example/" }).success).toBe(false);
    expect(
      profileLinkSchema.safeParse({ kind: "other", url: "https://my.blog.example/", label: "Blog" }).success,
    ).toBe(true);
    expect(
      profileLinkSchema.safeParse({ kind: "other", url: "javascript:alert(1)", label: "Blog" }).success,
    ).toBe(false);
  });

  it("refuse an unknown kind and a strong-language label", () => {
    expect(profileLinkSchema.safeParse({ kind: "myspace", url: "https://myspace.com/a" }).success).toBe(false);
    const result = profileLinkSchema.safeParse({
      kind: "other",
      url: "https://a.example/",
      label: `${rot13("shpx")} this`,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].path).toEqual(["label"]);
  });

  it("keep a mild word in a label (Damnation, Hell's Caretaker)", () => {
    expect(
      profileLinkSchema.safeParse({ kind: "other", url: "https://a.example/", label: "Hell's Caretaker" }).success,
    ).toBe(true);
  });

  it("cap the list and refuse duplicates", () => {
    const many = Array.from({ length: PROFILE_LINKS_MAX + 1 }, (_, i) => ({
      kind: "kofi",
      url: `https://ko-fi.com/forge${i}`,
    }));
    expect(profileLinksSchema.safeParse(many).success).toBe(false);
    expect(profileLinksSchema.safeParse(many.slice(0, PROFILE_LINKS_MAX)).success).toBe(true);
    const dup = profileLinksSchema.safeParse([
      { kind: "kofi", url: "https://ko-fi.com/forge" },
      { kind: "kofi", url: "https://ko-fi.com/forge/" },
    ]);
    expect(dup.success).toBe(false);
    if (!dup.success) expect(dup.error.issues[0].path).toEqual([1, "url"]);
  });

  it("draw only rows that still pass", () => {
    const rows = [
      { kind: "kofi", url: "https://ko-fi.com/forge" },
      { kind: "kofi", url: "javascript:alert(1)" },
      { kind: "twitch", url: "https://evil.example/" },
      { kind: "gone", url: "https://a.example/" },
    ];
    expect(drawableProfileLinks(rows)).toEqual([rows[0]]);
  });

  it("name a link by its site, and its label", () => {
    expect(profileLinkName({ kind: "kofi", label: null })).toBe("Ko-fi");
    expect(profileLinkName({ kind: "moxfield", label: "My cube" })).toBe("Moxfield — My cube");
    expect(profileLinkName({ kind: "other", label: "Blog" })).toBe("Blog");
  });
});
