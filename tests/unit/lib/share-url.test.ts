import { describe, expect, it } from "vitest";
import { cleanShareUrl, referralShareLine, referralUrlFor, shareUrlFor } from "@/lib/sharing/share-url";
import { extractReferralCode, referralSearch } from "@/lib/referrals/rules";

describe("shareUrlFor", () => {
  it("adds via, and ref only for a viewer with a code; an existing ref is replaced or dropped", () => {
    expect(shareUrlFor("https://pipglyph.com/card/a/b", { via: "x" })).toBe("https://pipglyph.com/card/a/b?via=x");
    expect(shareUrlFor("https://pipglyph.com/card/a/b", { via: "copy", ref: "ab12cd34" })).toBe(
      "https://pipglyph.com/card/a/b?via=copy&ref=ab12cd34",
    );
    expect(shareUrlFor("https://pipglyph.com/card/a/b?ref=old&q=1", { via: "reddit", ref: "new00000" })).toBe(
      "https://pipglyph.com/card/a/b?ref=new00000&q=1&via=reddit",
    );
    expect(shareUrlFor("https://pipglyph.com/card/a/b?ref=old", { via: "reddit", ref: null })).toBe(
      "https://pipglyph.com/card/a/b?via=reddit",
    );
    expect(shareUrlFor("not a url", { via: "x", ref: "ab12cd34" })).toBe("not a url");
  });
  it("cleanShareUrl strips both tags and nothing else", () => {
    expect(cleanShareUrl("https://pipglyph.com/card/a/b?via=copy&ref=ab12cd34&face=back")).toBe(
      "https://pipglyph.com/card/a/b?face=back",
    );
    expect(cleanShareUrl("https://pipglyph.com/card/a/b")).toBe("https://pipglyph.com/card/a/b");
  });
  it("the referral line names what the friend gets, in the settings' words — for their cards alone, no plan", () => {
    expect(referralShareLine("7 free days")).toBe(
      "Join with my link and you get 7 free days toward a plan once you've saved your first cards.",
    );
    expect(referralShareLine("30 free days")).toBe(
      "Join with my link and you get 30 free days toward a plan once you've saved your first cards.",
    );
    // The friend is asked for nothing but the cards (owner 2026-11-11).
    expect(referralShareLine("7 free days")).not.toMatch(/and started one|start(?:ed)? a plan|card on file/);
  });
});

// A plain "Copy link" (the Rule 0 table sheet, owner 2026-11-11): the copied
// address carries the sharer's referral code as every other share does —
// the code and NOTHING else (no `via`: there is no network to name).
describe("referralUrlFor", () => {
  it("adds only `ref`: no via, the path, the other parameters and the fragment as they were", () => {
    expect(referralUrlFor("https://pipglyph.com/table/abc123", "ab12cd34")).toBe("https://pipglyph.com/table/abc123?ref=ab12cd34");
    expect(referralUrlFor("https://pipglyph.com/table/abc123?face=back", "ab12cd34")).toBe(
      "https://pipglyph.com/table/abc123?face=back&ref=ab12cd34",
    );
    expect(referralUrlFor("https://pipglyph.com/table/abc123?face=back#notes", "ab12cd34")).toBe(
      "https://pipglyph.com/table/abc123?face=back&ref=ab12cd34#notes",
    );
    expect(referralUrlFor("http://localhost:3000/table/abc123", "ab12cd34")).toBe("http://localhost:3000/table/abc123?ref=ab12cd34");
    for (const url of ["https://pipglyph.com/table/abc123", "https://pipglyph.com/deck/burn?import=1"]) {
      const out = new URL(referralUrlFor(url, "ab12cd34"));
      expect(out.searchParams.get("ref")).toBe("ab12cd34");
      expect(out.searchParams.has("via")).toBe(false);
      // Exactly one parameter more than it came with.
      expect([...out.searchParams.keys()].filter((key) => key !== "ref")).toEqual([...new URL(url).searchParams.keys()]);
    }
  });
  it("an address that already carries a code gets the sharer's — one `ref`, never two", () => {
    const out = referralUrlFor("https://pipglyph.com/table/abc123?ref=00000000&face=back", "ab12cd34");
    expect(out).toBe("https://pipglyph.com/table/abc123?ref=ab12cd34&face=back");
    expect(new URL(out).searchParams.getAll("ref")).toEqual(["ab12cd34"]);
  });
  it("no code (signed out, the program off, the read failed): the url exactly as it was", () => {
    for (const ref of [null, undefined, ""]) {
      expect(referralUrlFor("https://pipglyph.com/table/abc123", ref)).toBe("https://pipglyph.com/table/abc123");
      // Untouched means untouched: an existing query is not rewritten, a code already on it is not stripped.
      expect(referralUrlFor("https://pipglyph.com/table/abc123?b=2&a=1#x", ref)).toBe("https://pipglyph.com/table/abc123?b=2&a=1#x");
      expect(referralUrlFor("not a url", ref)).toBe("not a url");
    }
  });
  it("an address that can't be parsed is handed back unchanged, never a throw", () => {
    for (const url of ["not a url", "", "/table/abc123", "//pipglyph.com/x"]) {
      expect(() => referralUrlFor(url, "ab12cd34"), url).not.toThrow();
      expect(referralUrlFor(url, "ab12cd34"), url).toBe(url);
    }
  });
  it("round trip: the friend's code reads back out of the copied link, and the clean address is the one it was made from", () => {
    const copied = referralUrlFor("https://pipglyph.com/table/abc123?face=back", "ab12cd34");
    expect(extractReferralCode(copied)).toBe("ab12cd34");
    expect(referralSearch(new URL(copied).searchParams)).toBe("?ref=ab12cd34");
    expect(cleanShareUrl(copied)).toBe("https://pipglyph.com/table/abc123?face=back");
  });
});
