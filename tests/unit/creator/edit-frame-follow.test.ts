import { describe, expect, it } from "vitest";
import { editFrameFollow, type EditFollowFace } from "@/lib/creator/edit-frame-follow";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { tokenHeightForText } from "@/lib/cards/token-height";
import type { ColorIdentity, FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// The frame that follows the text on an EDIT (owner decision 2026-11-22,
// lib/creator/edit-frame-follow.ts) — the ONE function updateCardAction and
// the creator's edit preview both ask: the token's box and height, the
// borderless walker's tall box, judged from the stored row to the row as the
// edit leaves it. It follows only while the stored frame is the one its
// stored text picks (a frame that disagrees is a pick, and stays), only onto
// a frame verified in the card's colour, never an admin's frame preview.
// ---------------------------------------------------------------------------

const EVERY_COLOUR = ["w", "u", "b", "r", "g", "c", "m"];
const verified = (...templates: string[]) =>
  new Set(templates.flatMap((t) => EVERY_COLOUR.map((k) => frameComboKey(t as FrameTemplate, k))));

const ARCH = verified("m15token", "m15tokentext", "m15tokentall", "m15tokenartifact", "m15tokenartifacttext", "m15tokenartifacttall");
const M20 = verified("m20token", "m20tokentext", "m20tokentall", "m20tokenartifact", "m20tokenartifacttext", "m20tokenartifacttall");
const WALKERS = verified("m15borderlesspw", "m15borderlesspwtall", "m15pw");

const soldier = (over: Partial<EditFollowFace> = {}): EditFollowFace => ({
  card_type: "token",
  supertype: "Creature",
  subtypes: ["Soldier"],
  title: "Soldier",
  rules_text: null,
  flavor_text: null,
  power: "1",
  toughness: "1",
  face_content: null,
  ...over,
});

// Long enough for the tall box on both designs (checked below).
const LONG =
  "When this creature enters, look at the top four cards of your library. You may reveal a noncreature, nonland card from among them and put it into your hand. Put the rest on the bottom of your library in a random order. Then scry 2, and you gain 2 life for each card revealed this way.";

function follow(
  template: string,
  stored: EditFollowFace,
  next: EditFollowFace,
  keys: ReadonlySet<string> | undefined,
  options: { colour?: ColorIdentity[]; framePreview?: boolean } = {},
) {
  return editFrameFollow({
    storedTemplate: template,
    stored,
    next,
    colorIdentity: options.colour ?? ["white"],
    verifiedKeys: keys,
    framePreview: options.framePreview,
  });
}

describe("a token's box and height follow its text", () => {
  it("the textless arch given its first line moves to the text box — and back when the text goes again", () => {
    const stored = soldier();
    const withText = soldier({ flavor_text: "Hold the line." });
    expect(follow("m15token", stored, withText, ARCH)).toEqual({ template: "m15tokentext", moved: "m15tokentext" });
    // The text removed again in the same edit: nothing moves.
    expect(follow("m15token", stored, soldier({ flavor_text: null }), ARCH)).toEqual({ template: "m15token", moved: null });
    // A stored text box whose text is all removed goes back to the textless arch.
    expect(follow("m15tokentext", withText, soldier(), ARCH)).toEqual({ template: "m15token", moved: "m15token" });
  });

  it("the full-art design follows its three heights, in its Artifact dress", () => {
    expect(tokenHeightForText({ rulesText: LONG, flavorText: null, printsPowerToughness: true, artifact: false })).toBe("tall");
    expect(follow("m20token", soldier(), soldier({ rules_text: "Vigilance" }), M20).moved).toBe("m20tokentext");
    expect(follow("m20tokentext", soldier({ rules_text: "Vigilance" }), soldier({ rules_text: LONG }), M20).moved).toBe("m20tokentall");
    expect(follow("m20tokentall", soldier({ rules_text: LONG }), soldier(), M20).moved).toBe("m20token");
    const treasure = (rules: string | null) =>
      soldier({ supertype: "Artifact", subtypes: ["Treasure"], power: null, toughness: null, rules_text: rules });
    expect(follow("m20tokenartifact", treasure(null), treasure("{T}, Sacrifice this artifact: Add one mana of any color."), M20).moved).toBe(
      "m20tokenartifacttext",
    );
  });

  it("an edit that leaves the text alone moves nothing (whatever else it changes)", () => {
    const stored = soldier({ rules_text: "Vigilance" });
    expect(follow("m15tokentext", stored, { ...stored, title: "Knight" }, ARCH)).toEqual({ template: "m15tokentext", moved: null });
    expect(follow("m20tokentext", stored, stored, M20)).toEqual({ template: "m20tokentext", moved: null });
  });
});

describe("the pin rule: a stored frame that disagrees with its stored text stays", () => {
  it("an empty text box (picked by hand) keeps its box when text arrives and when it goes", () => {
    expect(follow("m15tokentext", soldier(), soldier({ flavor_text: "A knight." }), ARCH)).toEqual({
      template: "m15tokentext",
      moved: null,
    });
    expect(follow("m20tokentext", soldier(), soldier({ rules_text: LONG }), M20)).toEqual({ template: "m20tokentext", moved: null });
  });

  it("the textless arch over text (its scrim, a pick) keeps it as the text changes", () => {
    const stored = soldier({ rules_text: "Vigilance" });
    expect(follow("m15token", stored, soldier({ rules_text: "Vigilance, haste" }), ARCH).moved).toBeNull();
  });

  it("a full-art height the text didn't pick (a Variations pick) keeps it", () => {
    // Short text on the tall box: the text would have picked the regular one.
    const stored = soldier({ rules_text: "Vigilance" });
    expect(follow("m20tokentall", stored, soldier(), M20).moved).toBeNull();
    expect(follow("m20tokentall", stored, soldier({ rules_text: "Haste" }), M20).moved).toBeNull();
  });

  it("an Artifact dress over words that don't say Artifact (or the plain frame over words that do) stays", () => {
    expect(follow("m15tokenartifact", soldier(), soldier({ flavor_text: "Clank." }), ARCH).moved).toBeNull();
    const artifactWords = soldier({ supertype: "Artifact Creature" });
    expect(follow("m15token", artifactWords, { ...artifactWords, flavor_text: "Clank." }, ARCH).moved).toBeNull();
  });

  it("a borderless walker on the box its rows don't pick (an import pinned to its printing) stays", () => {
    const walker = (rules: string): EditFollowFace => ({ card_type: "planeswalker", supertype: "Legendary", subtypes: ["Bolas"], rules_text: rules });
    const FOUR = "+1: A.\n−2: B.\n−3: C.\n−8: D.";
    const THREE = "+1: A.\n−2: B.\n−8: D.";
    expect(follow("m15borderlesspw", walker(FOUR), walker(`${FOUR}\n−9: E.`), WALKERS, { colour: ["black"] }).moved).toBeNull();
    expect(follow("m15borderlesspwtall", walker(THREE), walker("+1: A."), WALKERS, { colour: ["black"] }).moved).toBeNull();
  });
});

describe("the borderless walker's tall box follows its rows", () => {
  const walker = (over: Partial<EditFollowFace>): EditFollowFace => ({
    card_type: "planeswalker",
    supertype: "Legendary",
    subtypes: ["Tamsin"],
    rules_text: "+1: Draw a card.\n−2: Tap target creature.\n−7: You get an emblem.",
    face_content: null,
    ...over,
  });
  const FOUR_ROWS = {
    v: 1 as const,
    loyalty: {
      abilities: [
        { cost: "+1", text: "Draw a card." },
        { cost: "-2", text: "Tap target creature." },
        { cost: "-4", text: "Scry 4." },
        { cost: "-7", text: "You get an emblem." },
      ],
    },
  };

  it("a fourth row moves the regular box to the tall one — rows read before the text, as the renderers read them", () => {
    const stored = walker({});
    expect(follow("m15borderlesspw", stored, walker({ face_content: FOUR_ROWS }), WALKERS, { colour: ["blue"] })).toEqual({
      template: "m15borderlesspwtall",
      moved: "m15borderlesspwtall",
    });
    expect(
      follow("m15borderlesspw", stored, walker({ rules_text: `${stored.rules_text}\n−4: Scry 4.` }), WALKERS, { colour: ["blue"] }).moved,
    ).toBe("m15borderlesspwtall");
    // …and back to the regular box with three.
    expect(follow("m15borderlesspwtall", walker({ face_content: FOUR_ROWS }), stored, WALKERS, { colour: ["blue"] }).moved).toBe(
      "m15borderlesspw",
    );
  });

  it("every other walker frame stays put", () => {
    expect(follow("m15pw", walker({}), walker({ face_content: FOUR_ROWS }), WALKERS, { colour: ["blue"] }).moved).toBeNull();
  });
});

describe("only onto a frame verified in the card's colour", () => {
  it("an unverified target keeps the stored frame and names the frame the text asked for", () => {
    const keys = verified("m15token");
    expect(follow("m15token", soldier(), soldier({ flavor_text: "Hold the line." }), keys)).toEqual({
      template: "m15token",
      moved: null,
      unverified: "m15tokentext",
    });
    // Verified in another colour only: the same.
    const red = new Set([frameComboKey("m15tokentext", "r"), frameComboKey("m15token", "w")]);
    expect(follow("m15token", soldier(), soldier({ flavor_text: "x" }), red).unverified).toBe("m15tokentext");
    // The walker's tall box the same.
    const walker = (rules: string): EditFollowFace => ({ card_type: "planeswalker", rules_text: rules });
    expect(
      follow("m15borderlesspw", walker("+1: A.\n−2: B."), walker("+1: A.\n−2: B.\n−3: C.\n−8: D."), verified("m15borderlesspw")),
    ).toEqual({ template: "m15borderlesspw", moved: null, unverified: "m15borderlesspwtall" });
  });

  it("the arch's tall box unverified: its regular box stands in, silently", () => {
    expect(tokenHeightForText({ rulesText: LONG, flavorText: null, printsPowerToughness: true, artifact: false }, "arch")).toBe("tall");
    const noTall = verified("m15token", "m15tokentext");
    // From the textless arch: onto the regular box.
    expect(follow("m15token", soldier(), soldier({ rules_text: LONG }), noTall)).toEqual({ template: "m15tokentext", moved: "m15tokentext" });
    // Already on it: it stays, and nothing is said.
    expect(follow("m15tokentext", soldier({ rules_text: "Vigilance" }), soldier({ rules_text: LONG }), noTall)).toEqual({
      template: "m15tokentext",
      moved: null,
    });
    // Verified: the tall box.
    expect(follow("m15tokentext", soldier({ rules_text: "Vigilance" }), soldier({ rules_text: LONG }), ARCH).moved).toBe("m15tokentall");
  });

  it("without the verified keys: the frame the text asks for (the server's read-free first look)", () => {
    expect(follow("m15token", soldier(), soldier({ flavor_text: "x" }), undefined)).toEqual({ template: "m15tokentext", moved: "m15tokentext" });
    expect(follow("m15token", soldier(), soldier(), undefined).moved).toBeNull();
  });
});

describe("what never moves", () => {
  it("an admin's saved frame preview keeps the combo it previews", () => {
    expect(follow("m15token", soldier(), soldier({ flavor_text: "x" }), ARCH, { framePreview: true })).toEqual({
      template: "m15token",
      moved: null,
    });
  });

  it("any other kind or frame", () => {
    const creature = soldier({ card_type: "creature" });
    expect(follow("m15", creature, { ...creature, rules_text: LONG }, ARCH).moved).toBeNull();
    // A token on a frame with no heights (a showcase, Alpha's).
    expect(follow("m15", soldier(), soldier({ rules_text: LONG }), ARCH).moved).toBeNull();
  });

  it("a stored RETIRED template reads as its frame by the text it will hold — the row's own rewrite, never a move", () => {
    expect(follow("alphatoken", soldier(), soldier(), ARCH)).toEqual({ template: "m15token", moved: null });
    expect(follow("alphatoken", soldier(), soldier({ rules_text: "Haste" }), ARCH)).toEqual({ template: "m15tokentext", moved: null });
    expect(follow("alphatoken", soldier({ rules_text: "Haste" }), soldier(), new Set())).toEqual({ template: "m15token", moved: null });
  });
});
