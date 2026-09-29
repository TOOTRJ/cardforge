import { describe, expect, it } from "vitest";
import {
  followTokenTextBox,
  isTextBoxDress,
  textBoxFrameFits,
  textBoxFrameFor,
  tokenFrameFor,
  typeWordBaseFor,
} from "@/lib/creator/card-kinds";
import { resolveGeneratedFrame } from "@/lib/creator/frame-random";
import { autoTokenTextBoxFrame } from "@/lib/creator/frame-resolve";
import { hasRulesBoxText } from "@/lib/cards/card-display";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import type { FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.49 (b), owner decision 5 (2026-09-29): the token text box follows
// the text. On the token kind the 2014–19 arch wears its text-box variation
// (m15tokentext, and m15tokenartifacttext for an Artifact token) when the
// card has rules or flavour text, the textless one when it has none — in the
// creator until the user picks a variation by hand, in the AI jobs, and for
// the stored cards migration 0129 moved.
// ---------------------------------------------------------------------------

const EVERY_COLOUR = ["w", "u", "b", "r", "g", "c", "m"];
const allOf = (...templates: string[]) =>
  new Set(templates.flatMap((t) => EVERY_COLOUR.map((k) => frameComboKey(t as FrameTemplate, k))));
const TOKEN_FRAMES = allOf("m15token", "m15tokenartifact", "m15tokentext", "m15tokenartifacttext");

describe("has text — the renderers' test", () => {
  it("rules or flavour text that isn't blank", () => {
    expect(hasRulesBoxText({ rulesText: "Flying" })).toBe(true);
    expect(hasRulesBoxText({ flavorText: "Enemies of the heir, beware." })).toBe(true);
    expect(hasRulesBoxText({ rulesText: "  \n\t", flavorText: "\u3000\u00a0" })).toBe(false);
    expect(hasRulesBoxText({ rulesText: null, flavorText: undefined })).toBe(false);
    expect(hasRulesBoxText({})).toBe(false);
    // A zero-width space is not whitespace to String.prototype.trim.
    expect(hasRulesBoxText({ rulesText: "\u200b" })).toBe(true);
  });
});

describe("the text picks the text box", () => {
  it("on the token kind: text → the text-box arch, none → the textless one; the Artifact dress stays", () => {
    expect(textBoxFrameFor("token", "m15token", true)).toBe("m15tokentext");
    expect(textBoxFrameFor("token", "m15token", false)).toBe("m15token");
    expect(textBoxFrameFor("token", "m15tokentext", false)).toBe("m15token");
    expect(textBoxFrameFor("token", "m15tokentext", true)).toBe("m15tokentext");
    expect(textBoxFrameFor("token", "m15tokenartifact", true)).toBe("m15tokenartifacttext");
    expect(textBoxFrameFor("token", "m15tokenartifacttext", false)).toBe("m15tokenartifact");
  });

  it("leaves every other frame, and every other kind, alone", () => {
    for (const template of ["alphatoken", "fullart", "m15textless", "flip", "m15"] as FrameTemplate[]) {
      expect(textBoxFrameFor("token", template, true)).toBe(template);
      expect(textBoxFrameFor("token", template, false)).toBe(template);
    }
    expect(textBoxFrameFor("creature", "m15token", true)).toBe("m15token");
    expect(textBoxFrameFor("creature", "m15tokentext", false)).toBe("m15tokentext");
  });

  it("names the text-box variations as the kind's text dresses", () => {
    expect(isTextBoxDress("token", "m15tokentext")).toBe(true);
    expect(isTextBoxDress("token", "m15tokenartifacttext")).toBe(true);
    expect(isTextBoxDress("token", "m15token")).toBe(false);
    expect(isTextBoxDress("creature", "m15tokentext")).toBe(false);
    expect(textBoxFrameFits("token", "m15tokentext", true)).toBe(true);
    expect(textBoxFrameFits("token", "m15tokentext", false)).toBe(false);
    expect(textBoxFrameFits("token", "m15token", true)).toBe(false);
    expect(textBoxFrameFits("token", "alphatoken", true)).toBe(true);
  });

  it("composes with the Artifact word (tokenFrameFor) in either order", () => {
    const face = (supertype: string, text: string) => ({ supertype, rulesText: text, flavorText: null });
    for (const start of ["m15token", "m15tokenartifact", "m15tokentext", "m15tokenartifacttext"] as FrameTemplate[]) {
      expect(tokenFrameFor("token", start, face("Creature", ""))).toBe("m15token");
      expect(tokenFrameFor("token", start, face("Creature", "Flying"))).toBe("m15tokentext");
      expect(tokenFrameFor("token", start, face("Artifact", ""))).toBe("m15tokenartifact");
      expect(tokenFrameFor("token", start, face("Artifact", "{T}, Sacrifice this token: Add one mana of any color."))).toBe(
        "m15tokenartifacttext",
      );
    }
    expect(tokenFrameFor("token", "m15token", { supertype: "Creature", flavorText: "A knight." })).toBe("m15tokentext");
  });

  it("undresses the Artifact word for the setup panel's Variations", () => {
    expect(typeWordBaseFor("token", "m15tokenartifact")).toBe("m15token");
    expect(typeWordBaseFor("token", "m15tokenartifacttext")).toBe("m15tokentext");
    expect(typeWordBaseFor("token", "m15tokentext")).toBe("m15tokentext");
    expect(typeWordBaseFor("creature", "m15artifact")).toBe("m15artifact");
  });
});

describe("the creator's follow: automatic until the user picks a variation", () => {
  const follow = (template: FrameTemplate, hasText: boolean, manual = false) =>
    followTokenTextBox({ kind: "token", template, hasText, manual });

  it("switches while the frame is the one the text picked", () => {
    expect(follow("m15token", true)).toBe("m15tokentext");
    expect(follow("m15tokentext", false)).toBe("m15token");
    expect(follow("m15tokenartifact", true)).toBe("m15tokenartifacttext");
    expect(follow("m15tokenartifacttext", false)).toBe("m15tokenartifact");
  });

  it("a frame that disagreed with the text is a choice that sticks", () => {
    // The textless arch over text (picked by hand, or stored so): typing
    // more never moves it; an empty text box keeps its box when text comes.
    expect(follow("m15tokentext", true)).toBeNull();
    expect(follow("m15token", false)).toBeNull();
  });

  it("a variation picked by hand this session sticks either way", () => {
    expect(follow("m15token", true, true)).toBeNull();
    expect(follow("m15tokentext", false, true)).toBeNull();
  });

  it("never touches another frame or kind", () => {
    expect(follow("alphatoken", true)).toBeNull();
    expect(followTokenTextBox({ kind: "creature", template: "m15", hasText: true, manual: false })).toBeNull();
  });
});

describe("the AI jobs land on the variant the text picks", () => {
  const generated = (requested: FrameTemplate | "random", face: Record<string, unknown>, verified = TOKEN_FRAMES) =>
    resolveGeneratedFrame({
      cardType: "token",
      requested,
      colorIdentity: ["white"],
      verifiedKeys: verified,
      face: { cardType: "token", ...face },
      random: () => 0.99,
    });

  it("a requested arch token follows the generated text, either variant asked for", () => {
    for (const requested of ["m15token", "m15tokentext"] as FrameTemplate[]) {
      expect(generated(requested, { supertype: "Creature", rulesText: "Vigilance" })).toBe("m15tokentext");
      expect(generated(requested, { supertype: "Creature", flavorText: "A knight." })).toBe("m15tokentext");
      expect(generated(requested, { supertype: "Creature", rulesText: "", flavorText: " " })).toBe("m15token");
      expect(generated(requested, { supertype: "Artifact", rulesText: "Sacrifice: Add one mana." })).toBe(
        "m15tokenartifacttext",
      );
      expect(generated(requested, { supertype: "Artifact" })).toBe("m15tokenartifact");
    }
  });

  it("a random frame never puts text on the textless arch, nor an empty box under a vanilla token", () => {
    for (const roll of [0, 0.3, 0.6, 0.99]) {
      const pick = (face: Record<string, unknown>) =>
        resolveGeneratedFrame({
          cardType: "token",
          requested: "random",
          colorIdentity: ["white"],
          verifiedKeys: TOKEN_FRAMES,
          face: { cardType: "token", ...face },
          random: () => roll,
        });
      expect(pick({ supertype: "Creature", rulesText: "Flying" })).toBe("m15tokentext");
      expect(pick({ supertype: "Creature" })).toBe("m15token");
    }
  });

  it("an unpublished text box keeps the textless arch asked for (its scrim keeps the text), as the creator does", () => {
    const noBox = allOf("m15token", "m15tokenartifact");
    expect(generated("m15token", { supertype: "Creature", rulesText: "Flying" }, noBox)).toBe("m15token");
    expect(generated("m15tokentext", { supertype: "Artifact", rulesText: "Flying" }, noBox)).toBe("m15tokenartifact");
    expect(generated("random", { supertype: "Creature", rulesText: "Flying" }, noBox)).toBe("m15token");
  });

  it("the deck remix saves the variant its final text picks, when it is published", () => {
    const base = {
      cardType: "token" as const,
      supertype: "Creature",
      colorIdentity: ["white" as const],
      verifiedKeys: TOKEN_FRAMES,
    };
    // A textless printing (TDOM #3 Soldier) given the AI's flavour line.
    expect(autoTokenTextBoxFrame({ ...base, template: "m15token", flavorText: "Hold the line." })).toBe("m15tokentext");
    // A flavour-only printing whose remix has none left.
    expect(autoTokenTextBoxFrame({ ...base, template: "m15tokentext", rulesText: null, flavorText: null })).toBe("m15token");
    // Unpublished in the card's colour: the frame it had.
    expect(
      autoTokenTextBoxFrame({ ...base, template: "m15token", flavorText: "x", verifiedKeys: allOf("m15token") }),
    ).toBe("m15token");
    // Any other kind or frame as it is.
    expect(autoTokenTextBoxFrame({ ...base, cardType: "creature", template: "m15", flavorText: "x" })).toBe("m15");
    expect(autoTokenTextBoxFrame({ ...base, template: "alphatoken", flavorText: "x" })).toBe("alphatoken");
  });
});
