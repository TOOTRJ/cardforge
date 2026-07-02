import { describe, expect, it } from "vitest";

import {
  cardDimensions,
  extractElement,
  getNode,
  parseMseStyle,
  resolveMseValue,
} from "@/lib/mse/parse-mse-style";

// Fixture assembled from verbatim snippets of the Full-Magic-Pack's
// magic-m15.mse-style/style (the file the site's m15 frames were built from).
const M15_FIXTURE = `
############################ Header
card width: 375
card height: 523
card style:
	############################# Background stuff
	border color:
		left: 0
		top : 0
		width:	375
		height:	523
	name:
		left: { if card.card_symbol == "none" then 32 else 50 }
		top: 30
		right:  { 341 - card_style.casting_cost.content_width }
		height: 23
		font:
			name: Beleren Bold
			size: 16
			color: black
	casting cost:
		right: 346
		top: 29
		width: { max(30, card_style.casting_cost.content_width) + 5 }
		height: 23
		font:
			name: MPlantin
			size: 15
		symbol font:
			name: magic-mana-large
			size: 15
	image:
		left: 29
		top: 60
		width: 316
		height:	231
	type:
		left: { if has_identity() then "52" else "32" }
		top: 296
		width: { (if has_identity() then "290" else "310") - max(22,card_style.rarity.content_width) }
		height: 20
		font:
			name: Beleren Bold
			size: 13
	text:
		left: 29
		top: 327
		width: 314
		height: 154
		font:
			name: MPlantin
			size: 14
			scale down to: 6
	pt:
		left: 286
		top: 469
		width: 60
		height:	28
		font:
			name: Beleren Bold
			size: 16
`;

describe("parseMseStyle", () => {
  const root = parseMseStyle(M15_FIXTURE);

  it("reads the card dimensions header", () => {
    expect(cardDimensions(root)).toEqual({ w: 375, h: 523 });
  });

  it("builds the nested card-style tree", () => {
    expect(getNode(root, "card style", "name", "top")?.value).toBe("30");
    expect(getNode(root, "card style", "name", "font", "size")?.value).toBe("16");
    expect(getNode(root, "card style", "casting cost", "symbol font", "size")?.value).toBe("15");
  });

  it("handles `key : value` spacing and tab-indented values", () => {
    expect(getNode(root, "card style", "border color", "top")?.value).toBe("0");
    expect(getNode(root, "card style", "image", "height")?.value).toBe("231");
  });
});

describe("resolveMseValue", () => {
  it("resolves literals", () => {
    expect(resolveMseValue("30")).toMatchObject({ px: 30, strategy: "literal" });
    expect(resolveMseValue("-4.5")).toMatchObject({ px: -4.5 });
  });

  it("picks the plain-card branch of if/else chains", () => {
    // Feature-ABSENT condition (== "none") → then-branch is the default.
    expect(
      resolveMseValue('{ if card.card_symbol == "none" then 32 else 50 }'),
    ).toMatchObject({ px: 32, strategy: "then-branch" });
    // Feature-PRESENT condition (has_identity()) → else-branch is the default.
    expect(
      resolveMseValue('{ if has_identity() then "52" else "32" }'),
    ).toMatchObject({ px: 32, strategy: "else-branch" });
    // if/else-if chains fall through to the final else.
    expect(
      resolveMseValue('{if text_shape() == "0" then 432 else if text_shape() == "1" then 414 else 353}'),
    ).toMatchObject({ px: 353, strategy: "else-branch" });
  });

  it("flags content-dependent expressions as dynamic", () => {
    expect(
      resolveMseValue("{ 341 - card_style.casting_cost.content_width }"),
    ).toMatchObject({ px: null, strategy: "dynamic" });
    expect(
      resolveMseValue("{ max(30, card_style.casting_cost.content_width) + 5 }"),
    ).toMatchObject({ px: null, strategy: "dynamic" });
  });

  it("treats missing values as missing", () => {
    expect(resolveMseValue(undefined)).toMatchObject({ strategy: "missing" });
  });
});

describe("extractElement", () => {
  const root = parseMseStyle(M15_FIXTURE);

  it("converts the image element to card-relative percents", () => {
    const art = extractElement(root, "image");
    // 29/375, 60/523, 316/375, 231/523
    expect(art).toMatchObject({
      leftPct: 7.73,
      topPct: 11.47,
      widthPct: 84.27,
      heightPct: 44.17,
    });
  });

  it("resolves name via the else branch and reports dynamic right", () => {
    const name = extractElement(root, "name");
    expect(name?.leftPct).toBe(8.53); // 32/375
    expect(name?.topPct).toBe(5.74); // 30/523
    expect(name?.heightPct).toBe(4.4); // 23/523
    expect(name?.fontSizeFrac).toBe(0.0427); // 16/375
    expect(Object.keys(name?.dynamic ?? {})).toContain("right");
  });

  it("reads the casting cost symbol font size", () => {
    const cost = extractElement(root, "casting cost");
    expect(cost?.symbolFontSizeFrac).toBe(0.04); // 15/375
  });

  it("derives width from right-left when both are literal", () => {
    const fixture = parseMseStyle(
      "card width: 375\ncard height: 523\ncard style:\n\tname:\n\t\tleft: 32\n\t\tright: 346\n\t\ttop: 30\n\t\theight: 23\n",
    );
    const name = extractElement(fixture, "name");
    expect(name?.widthPct).toBe(83.73); // (346-32)/375
  });

  it("returns null for absent elements", () => {
    expect(extractElement(root, "loyalty")).toBeNull();
  });
});
