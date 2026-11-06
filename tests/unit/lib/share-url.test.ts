import { describe, expect, it } from "vitest";
import { cleanShareUrl, referralShareLine, shareUrlFor } from "@/lib/sharing/share-url";

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
  it("the referral line names what the friend gets, in the settings' words", () => {
    expect(referralShareLine("30 free days of Plus")).toBe(
      "Join with my link and you get 30 free days of Plus when you save your first card.",
    );
  });
});
