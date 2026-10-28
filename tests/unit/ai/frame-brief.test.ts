import { describe, expect, it } from "vitest";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { FRAME_TEMPLATE_VALUES, type FrameTemplate } from "@/types/card";
import { frameBrief, frameColorKeysOf, frameFitOf, frameMoveNotice, frameRedoNote } from "@/lib/ai/frame-brief";
import { ART_BRIEF_TEMPLATES, frameArtBrief } from "@/lib/ai/frame-art-brief";
import {
  AI_DESIGN_KINDS,
  aiDialogColorKey,
  aiFrameOptions,
  aiKindOffReason,
  frameColorWords,
} from "@/lib/ai/frame-choices";

// ---------------------------------------------------------------------------
// Frame-first design (the AI dialog redesign, PR 1): what the dialog offers,
// the brief the designer reads for a frame picked by name, the fit check
// that keeps the frame or refuses, and the art direction per frame.
// ---------------------------------------------------------------------------

const COLOURS = ["w", "u", "b", "r", "g", "c", "m"];
const EVERY: ReadonlySet<string> = new Set(
  FRAME_TEMPLATE_VALUES.flatMap((template) => COLOURS.map((colour) => frameComboKey(template as FrameTemplate, colour))),
);
const only = (templates: string[], colours = COLOURS): ReadonlySet<string> =>
  new Set(templates.flatMap((template) => colours.map((colour) => frameComboKey(template as FrameTemplate, colour))));

describe("the dialog's kinds and frames", () => {
  it("offers the one-faced kinds only — no saga, two-part, double-faced, battle or emblem", () => {
    expect([...AI_DESIGN_KINDS]).toEqual(["creature", "instant", "sorcery", "artifact", "enchantment", "land", "planeswalker", "token"]);
  });

  it("a kind with no frame published is an off chip with its reason", () => {
    expect(aiKindOffReason("creature", only(["m15"]))).toBeNull();
    expect(aiKindOffReason("planeswalker", only(["m15"]))).toBe("No frame published yet");
  });

  it("offers every frame of the kind published in some colour — the dresses included (owner, milestone 1)", () => {
    const creature = aiFrameOptions("creature", EVERY, null).map((option) => option.template);
    for (const template of ["m15", "m15nyx", "m15artifact", "retro", "agclassic", "m15borderless", "stainedglass"]) {
      expect(creature, template).toContain(template);
    }
    const token = aiFrameOptions("token", EVERY, null).map((option) => option.template);
    for (const template of ["m15token", "m15tokentext", "m15tokenartifact", "m20token", "m20tokentall", "m20tokenartifacttext"]) {
      expect(token, template).toContain(template);
    }
    expect(aiFrameOptions("artifact", EVERY, null).map((option) => option.template)).toEqual(
      expect.arrayContaining(["m15vehicle", "m15station"]),
    );
    expect(aiFrameOptions("planeswalker", EVERY, null).map((option) => option.template)).toEqual(
      expect.arrayContaining(["m15pw", "m15borderlesspw", "m15borderlesspwtall"]),
    );
    // Nothing unpublished is listed at all.
    expect(aiFrameOptions("creature", only(["m15"]), null).map((option) => option.template)).toEqual(["m15"]);
  });

  it("a PINNED colour leaves a frame not published in it as an off chip with its reason; a free colour offers it", () => {
    const verified = new Set([...only(["m15"]), ...only(["m15nyx"], ["w", "u"])]);
    const pinned = aiFrameOptions("creature", verified, "r");
    expect(pinned.find((option) => option.template === "m15")?.offReason).toBeNull();
    expect(pinned.find((option) => option.template === "m15nyx")?.offReason).toBe("Not published in red yet");
    const free = aiFrameOptions("creature", verified, null);
    expect(free.find((option) => option.template === "m15nyx")).toMatchObject({ offReason: null, colorKeys: ["w", "u"] });
  });

  it("a card with no colour is held to the colourless frames, as the server reads it", () => {
    expect(aiDialogColorKey([])).toBe("c");
    expect(aiDialogColorKey(null)).toBe("c");
    expect(aiDialogColorKey(["red"])).toBe("r");
    const verified = new Set([...only(["m15"]), ...only(["m15nyx"], ["w", "u"])]);
    expect(aiFrameOptions("creature", verified, aiDialogColorKey([])).find((option) => option.template === "m15nyx")?.offReason).toBe(
      "Not published in colorless yet",
    );
  });

  it("names the colours a frame has, or any colour", () => {
    expect(frameColorWords(["w", "u", "r"])).toBe("white, blue or red");
    expect(frameColorWords(["g"])).toBe("green");
    expect(frameColorWords(COLOURS)).toBe("any color");
  });
});

describe("the frame brief", () => {
  it("names the frame, its era's wording and the text budget", () => {
    const brief = frameBrief("agclassic", "creature");
    expect(brief).toContain("FRAME (the maker picked it");
    expect(brief).toContain("first printings (1993)");
    expect(brief).toContain("under about 200 characters");
    expect(frameBrief("retro", "creature")).toContain("1997–2003");
    expect(frameBrief("modern", "creature")).toContain("2003–2014");
    expect(frameBrief("m15", "creature")).toContain("under about 300 characters");
  });

  it("Nyx on a creature asks for the Enchantment word; the artifact frame for the Artifact word", () => {
    expect(frameBrief("m15nyx", "creature")).toContain('supertype must include the word "Enchantment"');
    expect(frameBrief("m15artifact", "creature")).toContain('supertype must include the word "Artifact"');
    // On the plain frame the word would move the card onto Nyx.
    expect(frameBrief("m15", "creature")).toContain('must NOT include "Enchantment"');
  });

  it("a Vehicle needs its subtype and a P/T; the artifact frame forbids the subtypes of its dresses", () => {
    const vehicle = frameBrief("m15vehicle", "artifact");
    expect(vehicle).toContain('subtypes must include "Vehicle"');
    expect(vehicle).toContain("Crew N");
    expect(frameBrief("m15artifact", "artifact")).toMatch(/subtypes must NOT include "Vehicle" or "Spacecraft"/);
    expect(frameBrief("m15land", "land")).toContain('must NOT include "Planet"');
  });

  it("a station frame asks for its tiers", () => {
    const brief = frameBrief("m15station", "artifact");
    expect(brief).toContain('subtypes must include "Spacecraft"');
    expect(brief).toContain("tier lines");
  });

  it("a token's frame says its Artifact word and its height", () => {
    expect(frameBrief("m20token", "token")).toContain("NO text box");
    expect(frameBrief("m20token", "token")).toContain('must NOT include "Artifact"');
    expect(frameBrief("m20tokenartifacttext", "token")).toContain('supertype must include "Artifact"');
    expect(frameBrief("m20tokenartifacttext", "token")).toContain("text box is short");
    expect(frameBrief("m15tokentall", "token")).toContain("text box is tall");
    expect(frameBrief("m20tokennyx", "token")).toContain('supertype must include "Enchantment"');
  });

  it("a textless frame, a basic land frame and the walker boxes say so", () => {
    expect(frameBrief("m15textless", "creature")).toContain("prints NO rules or flavor text");
    expect(frameBrief("m15fullartland", "land")).toContain("ONE basic land");
    // No text budget beside "no rules text" on a basic land's frame.
    expect(frameBrief("m15fullartland", "land")).not.toContain("under about");
    expect(frameBrief("m15borderlesspwtall", "planeswalker")).toContain("FOUR or more loyalty abilities");
    expect(frameBrief("m15borderlesspw", "planeswalker")).toContain("two or three loyalty abilities");
  });

  it("holds a FREE colour to the frame's colours (none named when it has them all)", () => {
    expect(frameBrief("m15nyx", "creature", ["w", "u"])).toContain("Its color must be white or blue");
    expect(frameBrief("m15nyx", "creature", COLOURS)).not.toContain("Its color must be");
    expect(frameBrief("m15nyx", "creature")).not.toContain("Its color must be");
    expect(frameColorKeysOf("creature", "m15nyx", only(["m15nyx"], ["w", "u"]))).toEqual(["w", "u"]);
  });
});

describe("the fit check — the frame picked, never a random draw (owner: redo, then keep and tell)", () => {
  const creature = (over: Record<string, unknown> = {}) => ({
    template: "m15nyx" as FrameTemplate,
    cardType: "creature" as const,
    colorIdentity: ["white" as const],
    verifiedKeys: EVERY,
    face: { cardType: "creature", supertype: "Enchantment", subtypes: ["Spirit"], rulesText: "Vigilance", power: "2", toughness: "2" },
    ...over,
  });
  const token = (template: FrameTemplate, face: Record<string, unknown>) =>
    frameFitOf({ template, cardType: "token", colorIdentity: ["green"], verifiedKeys: EVERY, face: { cardType: "token", ...face } as never });

  it("EXACTLY the frame picked: exact, no notice", () => {
    expect(frameFitOf(creature())).toEqual({ frame: "m15nyx", exact: true, notice: null });
  });

  it("anywhere else the creator's own rules give it: a fit, never exact, with the reason", () => {
    // Standard M15 asked, an Enchantment Creature designed → Nyx.
    expect(frameFitOf(creature({ template: "m15" }))).toEqual({
      frame: "m15nyx",
      exact: false,
      notice: "Designed as an Enchantment Creature, so it's on Nyx.",
    });
    // Nyx asked, a plain creature designed → the plain frame.
    expect(frameFitOf(creature({ face: { cardType: "creature", supertype: null, subtypes: ["Spirit"], rulesText: "Vigilance" } }))).toEqual({
      frame: "m15",
      exact: false,
      notice: "Designed without the Enchantment type, so it's on Standard.",
    });
    // The plain full-art token asked, an Artifact Thopter designed.
    expect(token("m20token", { supertype: "Artifact Creature", subtypes: ["Thopter"], rulesText: "", power: "1", toughness: "1" })).toEqual({
      frame: "m20tokenartifact",
      exact: false,
      notice: "Designed as an Artifact token, so it's on Artifact Token.",
    });
    // The textless height asked, the design has text → the text box.
    expect(token("m20token", { supertype: "Creature", subtypes: ["Wolf"], rulesText: "Trample", power: "2", toughness: "2" })).toMatchObject({
      frame: "m20tokentext",
      exact: false,
      notice: "Its text needs the text box, so it's on Token, text box.",
    });
    // A Vehicle designed for the Artifact frame → the Vehicle frame.
    expect(
      frameFitOf({
        template: "m15artifact",
        cardType: "artifact",
        colorIdentity: ["colorless"],
        verifiedKeys: EVERY,
        face: { cardType: "artifact", supertype: null, subtypes: ["Vehicle"], rulesText: "Crew 2", power: "3", toughness: "3" },
      }),
    ).toEqual({ frame: "m15vehicle", exact: false, notice: "Designed as a Vehicle, so it's on Vehicle." });
  });

  it("a walker's box follows its rows, and says so", () => {
    const walker = (template: FrameTemplate, rows: number) =>
      frameFitOf({
        template,
        cardType: "planeswalker",
        colorIdentity: ["blue"],
        verifiedKeys: EVERY,
        face: {
          cardType: "planeswalker",
          supertype: "Legendary",
          subtypes: ["Veyra"],
          rulesText: Array.from({ length: rows }, (_, i) => `+${i}: Draw a card.`).join("\n"),
        },
      });
    expect(walker("m15borderlesspw", 4)).toMatchObject({ frame: "m15borderlesspwtall", exact: false, notice: "It has four or more loyalty abilities, so it's on Borderless Planeswalker, 4+ abilities." });
    expect(walker("m15borderlesspwtall", 2)).toMatchObject({ frame: "m15borderlesspw", exact: false, notice: "It has fewer than four loyalty abilities, so it's on Borderless Planeswalker." });
  });

  it("one no frame can dress fits nothing — no random frame", () => {
    // …a colour the frame isn't published in.
    expect(frameFitOf(creature({ verifiedKeys: new Set([...only(["m15nyx"], ["u"]), ...only(["m15"], ["u"])]) }))).toEqual({
      frame: null,
      exact: false,
      notice: null,
    });
  });

  it("the redo's brief says why the last design missed", () => {
    expect(frameRedoNote("m15", "Designed as an Enchantment Creature, so it's on Nyx.")).toBe(
      'YOUR LAST DESIGN MISSED THIS FRAME: Designed as an Enchantment Creature. This time the card MUST land on "Standard": follow every frame rule above exactly.',
    );
    expect(frameRedoNote("m15", null)).toContain("COULD NOT BE PUT ON THIS FRAME AT ALL");
    expect(frameMoveNotice({ picked: "m15", landed: "m15", cardType: "creature" })).toBeNull();
  });
});

describe("art direction per frame", () => {
  it("adds the look the frame asks for, and nothing for a plain frame", () => {
    expect(frameArtBrief("stainedglass")).toContain("stained-glass window");
    expect(frameArtBrief("sncartdeco")).toContain("art deco poster");
    expect(frameArtBrief("m15borderless")).toContain("fills the WHOLE card");
    expect(frameArtBrief("m15fullartland")).toContain("landscape");
    expect(frameArtBrief("agclassic")).toContain("early-1990s");
    expect(frameArtBrief("retro")).toContain("late-1990s");
    expect(frameArtBrief("m15token")).toContain("single subject");
    expect(frameArtBrief("m20tokentext")).toContain("single subject");
    expect(frameArtBrief("m20tokentext")).toContain("WHOLE card");
    for (const template of ["m15", "m15land", "m15artifact", "m15pw", null, undefined, "not-a-frame"]) {
      expect(frameArtBrief(template), String(template)).toBe("");
    }
  });

  it("names only real templates, and no franchise or set", () => {
    for (const template of ART_BRIEF_TEMPLATES) {
      expect(FRAME_TEMPLATE_VALUES as readonly string[]).toContain(template);
      expect(frameArtBrief(template)).not.toMatch(/ring|tardis|avatar|capenna|tarkir|zendikar|theros|strixhaven|bloomburrow|karlov|wizards|lord of/i);
    }
  });
});
