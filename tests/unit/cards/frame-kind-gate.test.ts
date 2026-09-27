import { describe, expect, it } from "vitest";
import {
  cardFieldsFace,
  frameKindGateError,
  frameKindUpdateGateError,
} from "@/lib/cards/frame-kind-gate";

// The server's kind gate (TODO 0.26), next to frameGateError: a published
// frame can still be the wrong one for the card. createCardAction and
// updateCardAction refuse a planeswalker or battle on the frames with no
// stat overlay, and anything but one basic land on the full-art basic
// frame, so a crafted payload can't get past the disabled chip.

const plains = cardFieldsFace({
  card_type: "land",
  supertype: "Basic",
  subtypes: ["Plains"],
  title: "Plains",
  rules_text: null,
});
const hallowedFountain = cardFieldsFace({
  card_type: "land",
  supertype: null,
  subtypes: ["Plains", "Island"],
  title: "Hallowed Fountain",
  rules_text: "({T}: Add {W} or {U}.)\nAs Hallowed Fountain enters, you may pay 2 life.",
});
const walker = cardFieldsFace({ card_type: "planeswalker", title: "Nissa" });
const battle = cardFieldsFace({ card_type: "battle", title: "Invasion of Zendikar" });
const creature = cardFieldsFace({ card_type: "creature", title: "Makindi Ox" });

describe("frameKindGateError", () => {
  it("refuses a planeswalker or battle on a frame with no stat overlay, naming the frame", () => {
    const error = frameKindGateError("fullart", walker);
    expect(error).toBe(
      "The Zendikar Rising Hedron frame doesn't dress Planeswalker cards — pick another frame.",
    );
    expect(frameKindGateError("m15textless", battle)).toMatch(/Battle cards/);
    expect(frameKindGateError("extendedart", walker)).not.toBeNull();
  });

  it("lets the kinds those frames can draw through", () => {
    expect(frameKindGateError("fullart", creature)).toBeNull();
    expect(frameKindGateError("extendedart", creature)).toBeNull();
    expect(frameKindGateError("m15pw", walker)).toBeNull();
    expect(frameKindGateError("battle", battle)).toBeNull();
  });

  it("refuses a nonbasic land on the full-art basic frame and passes a basic", () => {
    expect(frameKindGateError("fullartland", hallowedFountain)).toBe(
      "Full-art basic frames are for basic lands — pick another frame.",
    );
    expect(frameKindGateError("fullartland", plains)).toBeNull();
    // The same nonbasic is fine on any other land frame.
    expect(frameKindGateError("m15land", hallowedFountain)).toBeNull();
    expect(frameKindGateError("expeditionland", hallowedFountain)).toBeNull();
  });

  it("keeps the existing showcase restrictions on the server too", () => {
    expect(frameKindGateError("nyx", creature)).toMatch(/Nyx Constellation frame doesn't dress Creature cards/);
    expect(frameKindGateError("fullartland", creature)).toMatch(/doesn't dress Creature cards/);
  });

  it("keeps the borderless M15 frame (4.32) to the kinds its pack draws", () => {
    expect(frameKindGateError("m15borderless", creature)).toBeNull();
    expect(frameKindGateError("m15borderless", cardFieldsFace({ card_type: "instant" }))).toBeNull();
    expect(frameKindGateError("m15borderless", walker)).toBe(
      "The M15 (2015) Borderless frame doesn't dress Planeswalker cards — pick another frame.",
    );
    expect(frameKindGateError("m15borderless", plains)).toMatch(/doesn't dress Land cards/);
    expect(frameKindGateError("m15borderlessartifact", cardFieldsFace({ card_type: "artifact" }))).toBeNull();
    // An Artifact Creature borrows the artifact dress (like m15artifact, 1.7).
    expect(
      frameKindGateError("m15borderlessartifact", cardFieldsFace({ card_type: "creature", supertype: "Artifact" })),
    ).toBeNull();
    expect(frameKindGateError("m15borderlessartifact", cardFieldsFace({ card_type: "sorcery" }))).toMatch(
      /Borderless Artifact frame doesn't dress Sorcery cards/,
    );
  });

  it("keeps the black-bordered full-art basic (4.39) to one basic land", () => {
    expect(frameKindGateError("m15fullartland", plains)).toBeNull();
    expect(frameKindGateError("m15fullartland", hallowedFountain)).toBe(
      "Full-art basic frames are for basic lands — pick another frame.",
    );
    expect(frameKindGateError("m15fullartland", creature)).toMatch(/doesn't dress Creature cards/);
  });

  it("never refuses a border-era frame an off-kind legacy card sits on", () => {
    expect(frameKindGateError("m15", cardFieldsFace({ card_type: "artifact" }))).toBeNull();
    expect(frameKindGateError("m15", cardFieldsFace({ card_type: "token" }))).toBeNull();
    // Unknown and missing templates render as the default frame.
    expect(frameKindGateError("regular", walker)).toBeNull();
    expect(frameKindGateError(undefined, walker)).toBeNull();
  });
});

describe("frameKindUpdateGateError", () => {
  it("refuses a patch that moves a card onto a frame that can't draw it", () => {
    expect(
      frameKindUpdateGateError({
        existingTemplate: "m15pw",
        nextTemplate: "fullart",
        existing: walker,
        next: walker,
      }),
    ).toMatch(/Planeswalker cards/);
  });

  it("refuses a patch that turns a drawable card into one the frame can't draw", () => {
    // A full-art Plains renamed and retyped into a shockland.
    expect(
      frameKindUpdateGateError({
        existingTemplate: "fullartland",
        nextTemplate: undefined,
        existing: plains,
        next: hallowedFountain,
      }),
    ).toMatch(/Full-art basic frames are for basic lands/);
  });

  it("keeps a card that already broke the rule editable while its frame stays", () => {
    expect(
      frameKindUpdateGateError({
        existingTemplate: "fullartland",
        nextTemplate: undefined,
        existing: hallowedFountain,
        next: { ...hallowedFountain, title: "Hallowed Fountain (alt)" },
      }),
    ).toBeNull();
    // Re-sending the same template isn't a change either.
    expect(
      frameKindUpdateGateError({
        existingTemplate: "fullart",
        nextTemplate: "fullart",
        existing: walker,
        next: walker,
      }),
    ).toBeNull();
  });

  it("still refuses a move from one wrong frame to another", () => {
    expect(
      frameKindUpdateGateError({
        existingTemplate: "fullart",
        nextTemplate: "m15textless",
        existing: walker,
        next: walker,
      }),
    ).not.toBeNull();
  });

  it("passes a patch that fixes the card", () => {
    expect(
      frameKindUpdateGateError({
        existingTemplate: "fullartland",
        nextTemplate: undefined,
        existing: hallowedFountain,
        next: plains,
      }),
    ).toBeNull();
    expect(
      frameKindUpdateGateError({
        existingTemplate: "fullart",
        nextTemplate: "m15pw",
        existing: walker,
        next: walker,
      }),
    ).toBeNull();
  });
});
