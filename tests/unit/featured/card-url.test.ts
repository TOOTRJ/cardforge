import { describe, expect, it, vi } from "vitest";
import { parseCardPageUrl, siteOrigins } from "@/lib/featured/card-url";

// The card page an admin pastes into /admin/featured: a bare path or this
// site's own URL — never another host's, whose handle and slug would resolve
// to whatever card this database holds under the same names.

const SITE = ["https://pipglyph.com"];
const CARD = { ok: true, username: "dev_artist", slug: "cinderwing-matriarch" };

describe("parseCardPageUrl", () => {
  it("takes a bare path and the site's own URL, its www twin too", () => {
    for (const url of [
      "/card/dev_artist/cinderwing-matriarch",
      "/card/dev_artist/cinderwing-matriarch/",
      "  https://pipglyph.com/card/dev_artist/cinderwing-matriarch  ",
      "https://www.pipglyph.com/card/dev_artist/cinderwing-matriarch",
    ]) {
      expect(parseCardPageUrl(url, SITE)).toEqual(CARD);
    }
  });

  it("lower-cases the handle, the slug and the host", () => {
    expect(parseCardPageUrl("https://WWW.PipGlyph.com/card/Dev_Artist/Cinderwing-Matriarch", SITE)).toEqual(CARD);
  });

  it("ignores a query and a hash", () => {
    expect(parseCardPageUrl("https://pipglyph.com/card/dev_artist/cinderwing-matriarch?via=x&face=back#art", SITE)).toEqual(CARD);
    expect(parseCardPageUrl("/card/dev_artist/cinderwing-matriarch/#top", SITE)).toEqual(CARD);
  });

  it("refuses another host — a preview, a localhost, a look-alike, a protocol-relative URL", () => {
    for (const url of [
      "https://cardforge-git-main-tootrj.vercel.app/card/dev_artist/cinderwing-matriarch",
      "http://localhost:3000/card/dev_artist/cinderwing-matriarch",
      "https://pipglyph.com.evil.example/card/dev_artist/cinderwing-matriarch",
      "https://evilpipglyph.com/card/dev_artist/cinderwing-matriarch",
      "//evil.example/card/dev_artist/cinderwing-matriarch",
    ]) {
      expect(parseCardPageUrl(url, SITE)).toEqual({
        ok: false,
        error: "Paste a pipglyph.com card URL, e.g. /card/username/card-slug.",
      });
    }
  });

  it("refuses what isn't a card page or a web URL", () => {
    for (const url of [
      "",
      "/deck/ember-wyrm",
      "/card/dev_artist",
      "/card/dev_artist/cinderwing-matriarch/edit",
      "/x/card/dev_artist/cinderwing-matriarch",
      "javascript:alert(1)//pipglyph.com/card/a/b",
      "https://pipglyph.com/card/dev artist/slug",
    ]) {
      expect(parseCardPageUrl(url, SITE).ok).toBe(false);
    }
  });

  it("takes every origin the deployment answers on, and names the first", () => {
    const branch = "https://cardforge-git-feat-x-tootrj.vercel.app";
    const deployment = "https://cardforge-abc123-tootrj.vercel.app";
    const origins = [branch, branch, deployment];
    for (const host of [branch, deployment]) {
      expect(parseCardPageUrl(`${host}/card/dev_artist/cinderwing-matriarch`, origins)).toEqual(CARD);
    }
    expect(parseCardPageUrl("https://pipglyph.com/card/dev_artist/cinderwing-matriarch", origins)).toEqual({
      ok: false,
      error: "Paste a cardforge-git-feat-x-tootrj.vercel.app card URL, e.g. /card/username/card-slug.",
    });
  });

  it("reads the origins from the environment: the site URL, then Vercel's branch and deployment URLs", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://pipglyph.com");
    vi.stubEnv("VERCEL_BRANCH_URL", "");
    vi.stubEnv("VERCEL_URL", "cardforge-abc123-tootrj.vercel.app");
    expect(siteOrigins()).toEqual(["https://pipglyph.com", "https://cardforge-abc123-tootrj.vercel.app"]);
    expect(parseCardPageUrl("https://cardforge-abc123-tootrj.vercel.app/card/dev_artist/cinderwing-matriarch")).toEqual(CARD);
    vi.unstubAllEnvs();
  });
});
