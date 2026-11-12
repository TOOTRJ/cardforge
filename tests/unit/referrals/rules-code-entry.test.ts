import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import {
  REFERRAL_CLAIM_WINDOW_DAYS,
  REFERRAL_PARAM,
  extractReferralCode,
  normalizeReferralCode,
  referralLink,
  referralSearch,
} from "@/lib/referrals/rules";

// ---------------------------------------------------------------------------
// The two pure helpers of the referral code's recovery (owner 2026-11-11):
//
//   * extractReferralCode — what a person TYPES or pastes into "Have a
//     referral code?": the code alone, or any link that carries it. It hands
//     back the 8-hex code or null, so a typed value is never sent to the
//     claim as it was typed.
//   * referralSearch — the query a redirect keeps when it would otherwise
//     drop the whole query: `?ref=<code>` for a valid code and NOTHING else
//     (an old card address, a renamed deck, /faq, /sets, a retired tag hub).
//     Only the code may travel — never another parameter, never a value that
//     is not a code (it goes into a Location header).
//
// …and the window a code can be claimed in: 14 days (it was 7).
// ---------------------------------------------------------------------------

const CODE = "ab12cd34";

describe("the claim window", () => {
  it("is 14 days — code entry is for NEW accounts only", () => {
    expect(REFERRAL_CLAIM_WINDOW_DAYS).toBe(14);
  });
});

describe("extractReferralCode — a typed code or a pasted link", () => {
  it("reads the code typed alone: trimmed, in any case", () => {
    expect(extractReferralCode(CODE)).toBe(CODE);
    expect(extractReferralCode("AB12CD34")).toBe(CODE);
    expect(extractReferralCode("  Ab12Cd34\n")).toBe(CODE);
    expect(extractReferralCode("\tab12cd34\t")).toBe(CODE);
    expect(extractReferralCode("00000000")).toBe("00000000");
  });

  it("reads the code out of the link a friend shares — with or without the scheme, wherever `ref` sits in the query", () => {
    for (const pasted of [
      referralLink("https://pipglyph.com", CODE),
      `https://pipglyph.com/?ref=${CODE}`,
      `http://localhost:3000/?ref=${CODE}`,
      `pipglyph.com/?ref=${CODE}`,
      `www.pipglyph.com?ref=${CODE}`,
      `/?ref=${CODE}`,
      `?ref=${CODE}`,
      // A shared card or deck link carries the code beside the share tag.
      `https://pipglyph.com/card/kesh/ember-sphinx?via=copy&ref=${CODE}`,
      `https://pipglyph.com/deck/burn?ref=${CODE}&via=x&import=1`,
      // The fragment is not part of the code.
      `https://pipglyph.com/?ref=${CODE}#how-it-works`,
      // Pasted with the words around it.
      `Join with my link: https://pipglyph.com/?ref=${CODE} and make a card`,
      `  https://pipglyph.com/?ref=${CODE}  `,
      `https://pipglyph.com/?ref=${CODE}\nsee you there`,
    ]) {
      expect(extractReferralCode(pasted), pasted).toBe(CODE);
    }
  });

  it("is case-insensitive in the parameter's name and in the code", () => {
    expect(extractReferralCode("https://pipglyph.com/?REF=AB12CD34")).toBe(CODE);
    expect(extractReferralCode("https://pipglyph.com/?Ref=aB12cD34&utm_source=x")).toBe(CODE);
  });

  it("decodes a %-escaped code, and a malformed escape is no code (never a throw)", () => {
    // "%61" is "a".
    expect(extractReferralCode("https://pipglyph.com/?ref=%61b12cd34")).toBe(CODE);
    for (const pasted of [
      "https://pipglyph.com/?ref=%",
      "https://pipglyph.com/?ref=%zz12cd34",
      "https://pipglyph.com/?ref=ab12cd3%",
      "https://pipglyph.com/?ref=%E0%A4%A",
    ]) {
      expect(() => extractReferralCode(pasted), pasted).not.toThrow();
      expect(extractReferralCode(pasted), pasted).toBeNull();
    }
  });

  it("is null when nothing in it reads as a code: too short, too long, not hex, another parameter, no value", () => {
    for (const typed of [
      "",
      "   ",
      "hello",
      "ab12cd3",
      "ab12cd345",
      "zzzzzzzz",
      "ab12 cd34",
      "ab12-cd34",
      "https://pipglyph.com/",
      "https://pipglyph.com/?ref=",
      "https://pipglyph.com/?ref=ab12cd3",
      "https://pipglyph.com/?ref=ab12cd345",
      "https://pipglyph.com/?ref=zzzzzzzz",
      "https://pipglyph.com/?ref=<script>",
      // A parameter that only ENDS in "ref" is not the referral's.
      `https://pipglyph.com/?xref=${CODE}`,
      `https://pipglyph.com/?href=${CODE}&via=x`,
      `https://pipglyph.com/?via=${CODE}`,
      // The code in the PATH is not a link that carries it.
      `https://pipglyph.com/ref/${CODE}`,
    ]) {
      expect(extractReferralCode(typed), JSON.stringify(typed)).toBeNull();
    }
  });

  it("is null for anything that is not text", () => {
    for (const value of [null, undefined, 42, 0xab12cd34, true, {}, { code: CODE }, [CODE], () => CODE, Symbol("x")]) {
      expect(extractReferralCode(value), String(value)).toBeNull();
    }
  });

  it("hands back exactly what normalizeReferralCode accepts — a result is always the 8 lowercase hex characters", () => {
    for (const typed of [CODE, "AB12CD34", `https://pipglyph.com/?ref=${CODE.toUpperCase()}`, `x?a=1&ref=${CODE}#y`]) {
      const read = extractReferralCode(typed);
      expect(read).toMatch(/^[a-f0-9]{8}$/);
      expect(normalizeReferralCode(read)).toBe(read);
    }
  });
});

describe("referralSearch — the one thing a query-dropping redirect keeps", () => {
  it("URLSearchParams with a valid code: `?ref=<code>`, lowercased, and NOTHING else of the query", () => {
    expect(REFERRAL_PARAM).toBe("ref");
    expect(referralSearch(new URLSearchParams(`ref=${CODE}`))).toBe(`?ref=${CODE}`);
    expect(referralSearch(new URLSearchParams("ref=AB12CD34"))).toBe(`?ref=${CODE}`);
    expect(referralSearch(new URLSearchParams(`utm_source=newsletter&ref=${CODE}&via=copy&q=alpha&import=1`))).toBe(`?ref=${CODE}`);
    // Two values: the first, as `get` reads it.
    expect(referralSearch(new URLSearchParams(`ref=${CODE}&ref=11111111`))).toBe(`?ref=${CODE}`);
  });

  it("no code, or a value that is not one: the empty string — the redirect drops the query as it always did", () => {
    for (const query of ["", "utm_source=x", "ref=", "ref=nope", "ref=ab12cd3", "ref=ab12cd345", "ref=zzzzzzzz", `xref=${CODE}`]) {
      expect(referralSearch(new URLSearchParams(query)), query).toBe("");
    }
    // Never a value that could add a second parameter or break out of the header.
    for (const value of [`${CODE}&admin=1`, `${CODE}#x`, `${CODE}\r\nSet-Cookie: a=b`, "<script>", "javascript:alert(1)"]) {
      expect(referralSearch(new URLSearchParams({ ref: value })), value).toBe("");
    }
  });

  it("a request's own searchParams (what proxy.ts hands it)", () => {
    expect(referralSearch(new NextRequest(`http://localhost:3000/faq?utm_source=x&ref=${CODE}`).nextUrl.searchParams)).toBe(`?ref=${CODE}`);
    expect(referralSearch(new NextRequest("http://localhost:3000/faq?utm_source=x").nextUrl.searchParams)).toBe("");
  });

  it("a page's plain search-params object: a string, or the FIRST of an array", () => {
    expect(referralSearch({ ref: CODE })).toBe(`?ref=${CODE}`);
    expect(referralSearch({ ref: " AB12CD34 ", import: "1", face: "back" })).toBe(`?ref=${CODE}`);
    expect(referralSearch({ ref: [CODE, "11111111"] })).toBe(`?ref=${CODE}`);
    // Only the first counts — a valid code hidden behind a junk one is not dug out.
    expect(referralSearch({ ref: ["nope", CODE] })).toBe("");
    expect(referralSearch({ ref: [] })).toBe("");
    expect(referralSearch({ ref: undefined, face: "back" })).toBe("");
    expect(referralSearch({ face: "back" })).toBe("");
    expect(referralSearch({})).toBe("");
    for (const value of [42, null, true, { code: CODE }, [[CODE]]]) {
      expect(referralSearch({ ref: value }), String(value)).toBe("");
    }
  });

  it("an address with its own `?get=` is still a plain object: the code is read from `ref`", () => {
    expect(referralSearch({ get: "1", ref: CODE })).toBe(`?ref=${CODE}`);
    expect(referralSearch({ get: "1" })).toBe("");
  });

  it("nothing at all: the empty string, never a throw", () => {
    expect(referralSearch(null)).toBe("");
    expect(referralSearch(undefined)).toBe("");
  });

  it("whatever it is given, the answer is empty or exactly `?ref=` + 8 lowercase hex", () => {
    const inputs: Array<Parameters<typeof referralSearch>[0]> = [
      new URLSearchParams(`ref=${CODE}&x=1`),
      new URLSearchParams("ref=AB12CD34"),
      { ref: CODE, x: "1" },
      { ref: [CODE.toUpperCase()] },
      { ref: "nope" },
      null,
    ];
    for (const input of inputs) expect(referralSearch(input)).toMatch(/^(\?ref=[a-f0-9]{8})?$/);
  });
});
