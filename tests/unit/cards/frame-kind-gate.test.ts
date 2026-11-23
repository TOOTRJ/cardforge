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
    expect(frameKindGateError("nyx", cardFieldsFace({ card_type: "artifact" }))).toMatch(
      /Nyx Constellation frame doesn't dress Artifact cards/,
    );
    expect(frameKindGateError("fullartland", creature)).toMatch(/doesn't dress Creature cards/);
  });

  it("lets a creature wear Nyx, which an Enchantment Creature borrows (A3), like the artifact frame (1.7)", () => {
    expect(
      frameKindGateError("nyx", cardFieldsFace({ card_type: "creature", supertype: "Legendary Enchantment" })),
    ).toBeNull();
    // The Card step writes the word when the frame is picked; the server
    // doesn't check it, as for m15artifact.
    expect(frameKindGateError("nyx", creature)).toBeNull();
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

  it("refuses a planeswalker or battle on the IP showcases that print P/T only (TODO 4.5a)", () => {
    expect(frameKindGateError("tarkirghostfire", walker)).toBe(
      "The Tarkir: Dragonstorm Ghostfire frame doesn't dress Planeswalker cards — pick another frame.",
    );
    expect(frameKindGateError("bloomanime", walker)).toBe(
      "The Bloomburrow Anime frame doesn't dress Planeswalker cards — pick another frame.",
    );
    for (const template of [
      "lotr",
      "lotrscroll",
      "avatar",
      "bloomburrow",
      "bloomanime",
      "tarkirdraconic",
      "tarkirghostfire",
      "tarkirdragon",
    ]) {
      expect(frameKindGateError(template, walker), template).toMatch(/doesn't dress Planeswalker cards/);
      expect(frameKindGateError(template, battle), template).toMatch(/doesn't dress Battle cards/);
      expect(frameKindGateError(template, creature), template).toBeNull();
      expect(frameKindGateError(template, hallowedFountain), template).toBeNull();
    }
  });

  it("never refuses a border-era frame an off-kind legacy card sits on", () => {
    expect(frameKindGateError("m15", cardFieldsFace({ card_type: "artifact" }))).toBeNull();
    expect(frameKindGateError("m15", cardFieldsFace({ card_type: "token" }))).toBeNull();
    // Unknown and missing templates render as the default frame.
    expect(frameKindGateError("regular", walker)).toBeNull();
    expect(frameKindGateError(undefined, walker)).toBeNull();
  });
});

describe("frameKindGateError — the newer token frames and the new layout frames", () => {
  // The token frames past the 2014–19 arch's own pair sit in the m15 set,
  // so no capability rule judged them, and the new layout frames name their
  // kind whatever the card type (kindFromCard): a crafted or stale payload
  // saved a planeswalker on the full-art token or an instant on the Prepare
  // frame. The picker never offered either.
  const NEWER_TOKEN_FRAMES = [
    "m15tokentext",
    "m15tokenartifacttext",
    "m15tokentall",
    "m15tokenartifacttall",
    "m20token",
    "m20tokentext",
    "m20tokentall",
    "m20tokenartifact",
    "m20tokenartifacttext",
    "m20tokenartifacttall",
  ] as const;
  const land = cardFieldsFace({ card_type: "land", title: "Test Tower" });
  const instant = cardFieldsFace({ card_type: "instant", title: "Shock" });
  const token = (supertype: string, subtypes: string[]) => cardFieldsFace({ card_type: "token", supertype, subtypes, title: subtypes[0] ?? "Copy" });
  const emblem = cardFieldsFace({ card_type: "emblem", title: "Kaito" });

  it("refuses every card type but the token on the newer token frames", () => {
    for (const template of NEWER_TOKEN_FRAMES) {
      expect(frameKindGateError(template, walker), template).toMatch(/doesn't dress Planeswalker cards — pick another frame\.$/);
      expect(frameKindGateError(template, land), template).toMatch(/doesn't dress Land cards/);
      expect(frameKindGateError(template, instant), template).toMatch(/doesn't dress Instant cards/);
      expect(frameKindGateError(template, creature), template).toMatch(/doesn't dress Creature cards/);
      expect(frameKindGateError(template, battle), template).toMatch(/doesn't dress Battle cards/);
      expect(frameKindGateError(template, emblem), template).toMatch(/doesn't dress Emblem cards/);
    }
    expect(frameKindGateError("m20token", walker)).toBe("The M15 (2015) Token frame doesn't dress Planeswalker cards — pick another frame.");
  });

  it("still takes every token kind's card on every token frame: creature, artifact, enchantment, a Copy's bare Token, Vehicle and Spacecraft", () => {
    const tokens = [
      token("Creature", ["Soldier"]),
      token("Legendary Creature", ["Spirit"]),
      token("Artifact", ["Treasure"]),
      token("Artifact Creature", ["Thopter"]),
      token("Enchantment", ["Aura", "Role"]),
      token("", []),
      token("Artifact", ["Vehicle"]),
      token("Artifact", ["Spacecraft"]),
    ];
    for (const template of [...NEWER_TOKEN_FRAMES, "m15token", "m15tokenartifact"]) {
      for (const face of tokens) expect(frameKindGateError(template, face), `${template} ${face.supertype} ${face.subtypes?.join(" ")}`).toBeNull();
    }
    // The Nyx dress keeps its own rule: a token whose words say Enchantment.
    expect(frameKindGateError("m20tokennyx", token("Enchantment Creature", ["Nymph"]))).toBeNull();
    expect(frameKindGateError("m20tokennyx", walker)).not.toBeNull();
  });

  it("leaves the 2014–19 arch's own pair to the legacy cards that sit on it", () => {
    for (const template of ["m15token", "m15tokenartifact"]) {
      expect(frameKindGateError(template, creature), template).toBeNull();
      expect(frameKindGateError(template, walker), template).toBeNull();
    }
  });

  it("keeps an emblem on the emblem frame alone — a layout frame's kind never hides it", () => {
    expect(frameKindGateError("emblem", emblem)).toBeNull();
    expect(frameKindGateError("emblem", token("Creature", ["Soldier"]))).not.toBeNull();
    for (const template of ["saga", "adventure", "split", "aftermath", "flip", "m15dfcfront", "m15mdfcfront", "prepare", "sagacreature", "m15", "m15token"]) {
      expect(frameKindGateError(template, emblem), template).toMatch(/doesn't dress Emblem cards/);
    }
  });

  it("refuses every card type but the Prepare kind's creature on the Prepare frame and its extended-art dress", () => {
    for (const template of ["prepare", "extendedartprepare"]) {
      expect(frameKindGateError(template, creature), template).toBeNull();
      expect(frameKindGateError(template, cardFieldsFace({ card_type: "creature", supertype: "Legendary", subtypes: ["Human", "Wizard"], title: "A" })), template).toBeNull();
      for (const type of ["instant", "sorcery", "artifact", "enchantment", "land", "planeswalker", "battle", "token"]) {
        expect(frameKindGateError(template, cardFieldsFace({ card_type: type, title: "A" })), `${template} ${type}`).toMatch(/doesn't dress .* cards — pick another frame\.$/);
      }
    }
    expect(frameKindGateError("prepare", walker)).toBe("The M15 (2015) Prepare frame doesn't dress Planeswalker cards — pick another frame.");
  });

  it("takes a saga whose words say Creature on the saga creature, and no other card type", () => {
    const summon = cardFieldsFace({ card_type: "enchantment", supertype: "Creature", subtypes: ["Saga", "Dragon"], title: "Summon: Bahamut" });
    expect(frameKindGateError("sagacreature", summon)).toBeNull();
    expect(frameKindGateError("sagacreature", cardFieldsFace({ card_type: "creature", supertype: "Enchantment", subtypes: ["Saga"], title: "A" }))).toBeNull();
    for (const type of ["instant", "sorcery", "artifact", "land", "planeswalker", "battle", "token"]) {
      expect(frameKindGateError("sagacreature", cardFieldsFace({ card_type: type, supertype: "Creature", title: "A" })), type).toMatch(/doesn't dress .* cards/);
    }
    // The other layout frames still keep their legacy cards.
    expect(frameKindGateError("saga", walker)).toBeNull();
    expect(frameKindGateError("adventure", walker)).toBeNull();
  });

  it("keeps a stored card that broke the rule editable while its frame stays, and refuses a move onto the frame", () => {
    // Stored before the fix: a walker on the full-art token, an instant on the Prepare frame.
    expect(frameKindUpdateGateError({ existingTemplate: "m20token", nextTemplate: undefined, existing: walker, next: { ...walker, title: "Renamed" } })).toBeNull();
    expect(frameKindUpdateGateError({ existingTemplate: "prepare", nextTemplate: "prepare", existing: instant, next: instant })).toBeNull();
    // A move onto one is judged in full.
    expect(frameKindUpdateGateError({ existingTemplate: "m15pw", nextTemplate: "m20token", existing: walker, next: walker })).toMatch(/Planeswalker cards/);
    expect(frameKindUpdateGateError({ existingTemplate: "m15", nextTemplate: "prepare", existing: instant, next: instant })).toMatch(/Instant cards/);
    // …and a legal card the edit turns illegal is refused.
    expect(
      frameKindUpdateGateError({ existingTemplate: "m20token", nextTemplate: undefined, existing: token("Creature", ["Soldier"]), next: walker }),
    ).toMatch(/Planeswalker cards/);
    // A token on the full-art frame stays editable.
    expect(
      frameKindUpdateGateError({ existingTemplate: "m20token", nextTemplate: "m20tokentext", existing: token("Creature", ["Soldier"]), next: token("Creature", ["Soldier"]) }),
    ).toBeNull();
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

  it("keeps a walker saved on a showcase before TODO 4.5a editable, and refuses turning a showcase creature into one", () => {
    // The legacy pin: the frame stays, the card stays savable.
    expect(
      frameKindUpdateGateError({
        existingTemplate: "tarkirghostfire",
        nextTemplate: undefined,
        existing: walker,
        next: { ...walker, title: "Nissa, renamed" },
      }),
    ).toBeNull();
    // A creature on the Ring frame retyped as a planeswalker is refused.
    expect(
      frameKindUpdateGateError({
        existingTemplate: "lotr",
        nextTemplate: undefined,
        existing: creature,
        next: walker,
      }),
    ).toMatch(/Planeswalker cards/);
    // Moving a walker onto one is refused.
    expect(
      frameKindUpdateGateError({
        existingTemplate: "m15pw",
        nextTemplate: "bloomanime",
        existing: walker,
        next: walker,
      }),
    ).toMatch(/Planeswalker cards/);
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
