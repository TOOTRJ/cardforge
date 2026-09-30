import { describe, expect, it } from "vitest";
import {
  isTextBoxDress,
  isTokenHeightDress,
  tokenFrameFits,
  tokenFrameFor,
  tokenHeightFrameFor,
} from "@/lib/creator/card-kinds";
import { resolveGeneratedFrame } from "@/lib/creator/frame-random";
import { autoTokenTextBoxFrame } from "@/lib/creator/frame-resolve";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import type { FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.48 (owner decisions 2026-09-29): the full-art token's height follows
// its text wherever a token's frame is decided away from the form — the one
// rule (tokenFrameFor) the creator's pickers, the AI jobs
// (resolveGeneratedFrame) and the deck remix (autoTokenTextBoxFrame) share
// with the 2014–19 arch's text box (round 11). The form's follow is
// tests/unit/components/creator-form-reliability.test.tsx "4.48".
// ---------------------------------------------------------------------------

const EVERY_COLOUR = ["w", "u", "b", "r", "g", "c", "m"];
const allOf = (...templates: string[]) =>
  new Set(templates.flatMap((t) => EVERY_COLOUR.map((k) => frameComboKey(t as FrameTemplate, k))));
const M20 = ["m20token", "m20tokentext", "m20tokentall", "m20tokenartifact", "m20tokenartifacttext", "m20tokenartifacttall"];
const ARCH = ["m15token", "m15tokenartifact", "m15tokentext", "m15tokenartifacttext"];
const LONG =
  "When this creature enters, look at the top four cards of your library. You may reveal a noncreature, nonland card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.";

describe("tokenFrameFor on the full-art design: the height the text asks for", () => {
  it("picks no box, the regular box or the tall box from whichever height it is handed", () => {
    for (const start of ["m20token", "m20tokentext", "m20tokentall"] as FrameTemplate[]) {
      expect(tokenFrameFor("token", start, { supertype: "Creature" }), start).toBe("m20token");
      expect(tokenFrameFor("token", start, { supertype: "Creature", rulesText: "Flying" }), start).toBe("m20tokentext");
      expect(tokenFrameFor("token", start, { supertype: "Creature", flavorText: LONG }), start).toBe("m20tokentall");
    }
  });

  it("composes with the Artifact word, in either order", () => {
    const treasure = { supertype: "Artifact", rulesText: "{T}, Sacrifice this token: Add one mana of any color." };
    for (const start of ["m20token", "m20tokenartifacttall"] as FrameTemplate[]) {
      expect(tokenFrameFor("token", start, treasure), start).toBe("m20tokenartifacttext");
      expect(tokenFrameFor("token", start, { supertype: "Artifact" }), start).toBe("m20tokenartifact");
    }
    expect(tokenFrameFor("token", "m20tokenartifacttext", { supertype: "Creature", rulesText: LONG })).toBe("m20tokentall");
  });

  it("keeps the rules out of the P/T plate: a printed P/T can need the tall box (unknown → a Creature token prints one)", () => {
    const text =
      "Whenever this creature attacks, you may pay {1}. If you do, create a 1/1 white Soldier creature token with lifelink that's tapped and attacking.";
    expect(tokenFrameFor("token", "m20token", { supertype: "Creature", rulesText: text, printsPowerToughness: false })).toBe("m20tokentext");
    expect(tokenFrameFor("token", "m20token", { supertype: "Creature", rulesText: text, printsPowerToughness: true })).toBe("m20tokentall");
    expect(tokenFrameFor("token", "m20token", { supertype: "Creature", rulesText: text })).toBe("m20tokentall");
    expect(tokenFrameFor("token", "m20token", { supertype: "Enchantment", rulesText: text })).toBe("m20tokentext");
  });

  it("leaves every other frame and kind alone — the arch keeps round 11's box", () => {
    expect(tokenHeightFrameFor("token", "m15tokentext", { rulesText: LONG })).toBe("m15tokentext");
    expect(tokenHeightFrameFor("creature", "m20tokentall", { rulesText: null })).toBe("m20tokentall");
    expect(tokenFrameFor("token", "alphatoken", { rulesText: LONG })).toBe("alphatoken");
    expect(tokenFrameFor("token", "m15token", { supertype: "Creature", rulesText: LONG })).toBe("m15tokentext");
  });

  it("fits only the frame its words and text pick; every other kind always fits", () => {
    expect(tokenFrameFits("token", "m20tokentext", { supertype: "Creature", rulesText: "Flying" })).toBe(true);
    expect(tokenFrameFits("token", "m20tokentall", { supertype: "Creature", rulesText: "Flying" })).toBe(false);
    expect(tokenFrameFits("token", "m20token", { supertype: "Creature", rulesText: "Flying" })).toBe(false);
    expect(tokenFrameFits("token", "m15token", { supertype: "Creature", rulesText: "Flying" })).toBe(false);
    expect(tokenFrameFits("creature", "m15", { rulesText: LONG })).toBe(true);
  });

  it("names the text's heights (the regular and the tall box) as dresses a frame list leaves to the text", () => {
    for (const t of ["m20tokentext", "m20tokentall", "m20tokenartifacttext", "m20tokenartifacttall"] as FrameTemplate[]) {
      expect(isTokenHeightDress("token", t), t).toBe(true);
    }
    for (const t of ["m20token", "m20tokenartifact", "m15token", "m15tokentext", "alphatoken"] as FrameTemplate[]) {
      expect(isTokenHeightDress("token", t), t).toBe(false);
    }
    expect(isTokenHeightDress("creature", "m20tokentext")).toBe(false);
    // The arch's text box is its own kind of dress (round 11).
    expect(isTextBoxDress("token", "m20tokentext")).toBe(false);
  });
});

describe("the AI jobs land on the height the text picks", () => {
  const generated = (requested: FrameTemplate | "random", face: Record<string, unknown>, verified = allOf(...M20, ...ARCH), roll = 0.99) =>
    resolveGeneratedFrame({
      cardType: "token",
      requested,
      colorIdentity: ["white"],
      verifiedKeys: verified,
      face: { cardType: "token", ...face },
      random: () => roll,
    });

  it("a requested full-art token follows the generated text, whichever height was asked for", () => {
    for (const requested of ["m20token", "m20tokentext", "m20tokentall"] as FrameTemplate[]) {
      expect(generated(requested, { supertype: "Creature", power: "2", toughness: "2" }), requested).toBe("m20token");
      expect(generated(requested, { supertype: "Creature", rulesText: "Vigilance", power: "2", toughness: "2" }), requested).toBe("m20tokentext");
      expect(generated(requested, { supertype: "Creature", rulesText: LONG, power: "1", toughness: "1" }), requested).toBe("m20tokentall");
      expect(generated(requested, { supertype: "Artifact", rulesText: "Sacrifice this token: Add one mana." }), requested).toBe(
        "m20tokenartifacttext",
      );
    }
  });

  it("a random token frame is never on another height than the text asks for", () => {
    for (const roll of [0, 0.2, 0.4, 0.6, 0.8, 0.99]) {
      const flying = generated("random", { supertype: "Creature", rulesText: "Flying", power: "1", toughness: "1" }, undefined, roll);
      expect(["m20tokentext", "m15tokentext"], String(roll)).toContain(flying);
      const vanilla = generated("random", { supertype: "Creature", power: "1", toughness: "1" }, undefined, roll);
      expect(["m20token", "m15token"], String(roll)).toContain(vanilla);
    }
  });

  it("a height not verified in the colour falls back like any unpublished frame", () => {
    // Only the textless full-art height: a request for it with text lands
    // on a published frame the text fits — the arch's box.
    const onlyTextless = allOf("m20token", "m20tokenartifact", ...ARCH);
    expect(generated("m20token", { supertype: "Creature", rulesText: "Flying" }, onlyTextless)).toBe("m15tokentext");
  });
});

describe("the deck remix saves the height its final text picks", () => {
  const base = {
    cardType: "token" as const,
    supertype: "Creature",
    colorIdentity: ["white" as const],
    verifiedKeys: allOf(...M20),
  };

  it("follows the saved text on the full-art design, when that height is published", () => {
    // A textless M20 printing (TFDN #6 Soldier) given the AI's flavour line.
    expect(autoTokenTextBoxFrame({ ...base, template: "m20token", flavorText: "Hold the line.", power: "1", toughness: "1" })).toBe(
      "m20tokentext",
    );
    // A long one: the tall box.
    expect(autoTokenTextBoxFrame({ ...base, template: "m20tokentext", flavorText: LONG, power: "1", toughness: "1" })).toBe("m20tokentall");
    // None left: no box.
    expect(autoTokenTextBoxFrame({ ...base, template: "m20tokentall", rulesText: null, flavorText: null })).toBe("m20token");
    // Unpublished in the card's colour: the frame it had…
    expect(
      autoTokenTextBoxFrame({ ...base, template: "m20tokentall", flavorText: "x", verifiedKeys: allOf("m20tokentall") }),
    ).toBe("m20tokentall");
    // …but never the textless height over text it would hide: the arch's
    // text box when that is published, else the frame it had.
    expect(
      autoTokenTextBoxFrame({ ...base, template: "m20token", flavorText: "x", verifiedKeys: allOf("m20token", ...ARCH) }),
    ).toBe("m15tokentext");
    expect(autoTokenTextBoxFrame({ ...base, template: "m20token", flavorText: "x", verifiedKeys: allOf("m20token") })).toBe("m20token");
  });
});
