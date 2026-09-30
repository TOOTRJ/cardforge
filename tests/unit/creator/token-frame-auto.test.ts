import { describe, expect, it } from "vitest";
import {
  autoM20TokenFrame,
  defaultTokenFrameIn,
  followTokenHeight,
  isArchTokenFrame,
  newTokenFrame,
  pinsTokenHeight,
  sameTokenFrameText,
  tokenFrameText,
} from "@/lib/creator/token-frame-auto";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { FRAME_TEMPLATE_LABELS, type FrameTemplate } from "@/types/card";
import { typeWordFrameFor } from "@/lib/creator/card-kinds";

// ---------------------------------------------------------------------------
// TODO 4.48 / 4.50 (owner decisions 2026-09-29): the creator's default
// switch to the full-art token and its automatic height, wired into round
// 11's text-box follow (components/creator/card-creator-form.tsx; the form's
// half is tests/unit/components/creator-form-reliability.test.tsx "4.48").
// ---------------------------------------------------------------------------

const ALL_M20 = ["m20token", "m20tokentext", "m20tokentall", "m20tokenartifact", "m20tokenartifacttext", "m20tokenartifacttall"];
const verified = (...combos: [FrameTemplate, string][]) => new Set(combos.map(([t, k]) => frameComboKey(t, k)));
const everyM20 = (colour: string) => verified(...ALL_M20.map((t) => [t as FrameTemplate, colour] as [FrameTemplate, string]));

const NONE = { rulesText: null, flavorText: null, printsPowerToughness: true, supertype: "Creature" };
const FLYING = { rulesText: "Flying", flavorText: null, printsPowerToughness: true, supertype: "Creature" };
const LONG = {
  rulesText:
    "Whenever you attack, choose one —\n• Create a 1/1 white Rabbit creature token that's tapped and attacking.\n• Attacking creatures you control get +1/+1 until end of turn.",
  flavorText: null,
  printsPowerToughness: true,
  supertype: "Creature",
};
const TREASURE = {
  rulesText: "{T}, Sacrifice this token: Add one mana of any color.",
  flavorText: null,
  printsPowerToughness: false,
  supertype: "Artifact",
};

describe("autoM20TokenFrame — the height the text asks for, dressed by the Artifact word", () => {
  it("picks textless / regular / tall, and the artifact template for an Artifact", () => {
    expect(autoM20TokenFrame(NONE)).toBe("m20token");
    expect(autoM20TokenFrame(FLYING)).toBe("m20tokentext");
    expect(autoM20TokenFrame(LONG)).toBe("m20tokentall");
    expect(autoM20TokenFrame(TREASURE)).toBe("m20tokenartifacttext");
    expect(autoM20TokenFrame({ ...NONE, supertype: "Artifact Creature" })).toBe("m20tokenartifact");
    expect(autoM20TokenFrame({ ...LONG, supertype: "Legendary Artifact Creature" })).toBe("m20tokenartifacttall");
  });
});

describe("newTokenFrame — the default switch (owner 2026-09-29: new tokens default to the full-art design once verified)", () => {
  it("starts on the arch round 11 picks while the full-art template isn't verified in the colour — its text box for text, its artifact dress", () => {
    expect(newTokenFrame(NONE, "w", new Set())).toBe("m15token");
    expect(newTokenFrame(FLYING, "w", new Set())).toBe("m15tokentext");
    expect(newTokenFrame(TREASURE, "c", new Set())).toBe("m15tokenartifacttext");
    expect(newTokenFrame({ ...NONE, supertype: "Artifact" }, "c", new Set())).toBe("m15tokenartifact");
    // Verified in another colour only.
    expect(newTokenFrame(FLYING, "w", everyM20("u"))).toBe("m15tokentext");
  });

  it("starts on the full-art template the text asks for once it is verified in the colour", () => {
    expect(newTokenFrame(NONE, "w", everyM20("w"))).toBe("m20token");
    expect(newTokenFrame(FLYING, "g", everyM20("g"))).toBe("m20tokentext");
    expect(newTokenFrame(LONG, "b", everyM20("b"))).toBe("m20tokentall");
    expect(newTokenFrame(TREASURE, "c", everyM20("c"))).toBe("m20tokenartifacttext");
    // Only the textless height verified: a token with text keeps the arch.
    expect(newTokenFrame(FLYING, "w", verified(["m20token", "w"]))).toBe("m15tokentext");
    expect(newTokenFrame(NONE, "w", verified(["m20token", "w"]))).toBe("m20token");
  });

  it("knows the arch in every dress — where a token entering the kind on the M15 era lands", () => {
    for (const t of ["m15token", "m15tokentext", "m15tokenartifact", "m15tokenartifacttext"]) expect(isArchTokenFrame(t), t).toBe(true);
    for (const t of ["m20token", "m20tokentall", "alphatoken", "m15", "nyx", null, undefined]) expect(isArchTokenFrame(t), String(t)).toBe(false);
  });
});

describe("defaultTokenFrameIn — a new token on the switch's pick follows a colour picked after its type", () => {
  const ARCH = ["m15token", "m15tokentext", "m15tokenartifact", "m15tokenartifacttext"] as FrameTemplate[];
  const arch = (colour: string) => ARCH.map((t) => [t, colour] as [FrameTemplate, string]);
  it("the full-art template where it is verified in the colour, the arch round 11 picks where it isn't", () => {
    const keys = new Set([...everyM20("w"), ...verified(...arch("u"), ...arch("w"))]);
    expect(defaultTokenFrameIn(FLYING, "m15tokentext", "w", keys)).toBe("m20tokentext");
    expect(defaultTokenFrameIn(FLYING, "m20tokentext", "u", keys)).toBe("m15tokentext");
    expect(defaultTokenFrameIn(TREASURE, "m20tokenartifacttext", "u", keys)).toBe("m15tokenartifacttext");
    expect(defaultTokenFrameIn(NONE, "m15token", "w", keys)).toBe("m20token");
  });
  it("keeps the full-art height the card wears where the one the text asks for isn't verified but it is", () => {
    // Tall unverified in white: the follow held the regular box; white keeps it.
    const keys = new Set([...verified(["m20tokentext", "w"], ["m20tokentext", "g"]), ...verified(...arch("w"), ...arch("g"))]);
    expect(defaultTokenFrameIn(LONG, "m20tokentext", "g", keys)).toBe("m20tokentext");
    // …but the arch where no full-art height it could wear is verified.
    expect(defaultTokenFrameIn(LONG, "m20tokentall", "g", keys)).toBe("m15tokentext");
  });
  it("falls back to the plain arch in its type-word dress, else null — nothing to wear in that colour", () => {
    const plainOnly = verified(["m15token", "r"], ["m15tokenartifact", "r"]);
    expect(defaultTokenFrameIn(FLYING, "m20tokentext", "r", plainOnly)).toBe("m15token");
    expect(defaultTokenFrameIn(TREASURE, "m20tokenartifacttext", "r", plainOnly)).toBe("m15tokenartifact");
    expect(defaultTokenFrameIn(FLYING, "m20tokentext", "b", plainOnly)).toBeNull();
  });
});

describe("tokenFrameText / sameTokenFrameText — what the form follows", () => {
  it("reads the words, the text and whether the face prints a P/T", () => {
    expect(
      tokenFrameText({ cardType: "token", supertype: "Creature", subtypes: ["Knight"], rulesText: "Vigilance", flavorText: null, power: "2", toughness: "2" }),
    ).toEqual({ supertype: "Creature", rulesText: "Vigilance", flavorText: null, printsPowerToughness: true });
    // A Treasure prints none, whatever the form still holds.
    expect(tokenFrameText({ cardType: "token", supertype: "Artifact", rulesText: "x", flavorText: "", power: "1", toughness: "1" }).printsPowerToughness).toBe(false);
  });

  it("compares them field by field, blank and null alike", () => {
    const a = tokenFrameText({ cardType: "token", supertype: "Creature", rulesText: null, flavorText: null, power: "1", toughness: "1" });
    expect(sameTokenFrameText(a, { ...a, rulesText: "" })).toBe(true);
    expect(sameTokenFrameText(a, { ...a, flavorText: "Hi." })).toBe(false);
    expect(sameTokenFrameText(a, { ...a, supertype: "Artifact Creature" })).toBe(false);
    expect(sameTokenFrameText(a, { ...a, printsPowerToughness: false })).toBe(false);
  });
});

describe("followTokenHeight — automatic, with a manual choice that sticks (owner decision 5)", () => {
  const base = { heightPinned: false, colorKey: "w", verifiedKeys: everyM20("w") };

  it("follows the text while the card wears the height the text asked for and the user hasn't picked one", () => {
    expect(followTokenHeight({ ...base, ...NONE, previous: NONE, template: "m20token" })).toBe("m20token");
    expect(followTokenHeight({ ...base, ...FLYING, previous: NONE, template: "m20token" })).toBe("m20tokentext");
    expect(followTokenHeight({ ...base, ...LONG, previous: FLYING, template: "m20tokentext" })).toBe("m20tokentall");
    // Text removed: back to no box.
    expect(followTokenHeight({ ...base, ...NONE, previous: LONG, template: "m20tokentall" })).toBe("m20token");
  });

  it("keeps a height the user picked, whatever the text — the Artifact word still dresses it", () => {
    const pinned = { ...base, heightPinned: true };
    expect(followTokenHeight({ ...pinned, ...NONE, previous: LONG, template: "m20tokentall" })).toBe("m20tokentall");
    expect(followTokenHeight({ ...pinned, ...LONG, previous: FLYING, template: "m20tokentext" })).toBe("m20tokentext");
    expect(followTokenHeight({ ...pinned, ...LONG, supertype: "Artifact", previous: LONG, template: "m20tokentext" })).toBe(
      "m20tokenartifacttext",
    );
    expect(followTokenHeight({ ...pinned, ...NONE, supertype: "Creature", previous: NONE, template: "m20tokenartifacttall" })).toBe(
      "m20tokentall",
    );
  });

  it("keeps a height that disagreed with the text before the edit: a stored card's earlier pick sticks (round 11's rule)", () => {
    // Saved on the tall box with one short line — a choice from an earlier
    // session, so nothing in this one set heightPinned.
    expect(followTokenHeight({ ...base, ...FLYING, rulesText: "Flying, vigilance", previous: FLYING, template: "m20tokentall" })).toBe(
      "m20tokentall",
    );
    // Saved textless with text on it: typing more keeps it textless.
    expect(followTokenHeight({ ...base, ...LONG, previous: FLYING, template: "m20token" })).toBe("m20token");
    // …and the Artifact word still dresses it.
    expect(followTokenHeight({ ...base, ...FLYING, supertype: "Artifact Creature", previous: FLYING, template: "m20tokentall" })).toBe(
      "m20tokenartifacttall",
    );
  });

  it("dresses by the Artifact word at the height the text asks for", () => {
    expect(
      followTokenHeight({ ...base, ...TREASURE, previous: { ...TREASURE, supertype: "Creature" }, colorKey: "c", verifiedKeys: everyM20("c"), template: "m20tokentext" }),
    ).toBe("m20tokenartifacttext");
  });

  it("never moves a card onto a combo that isn't verified in its colour", () => {
    const onlyTextless = { ...base, verifiedKeys: verified(["m20token", "w"]) };
    expect(followTokenHeight({ ...onlyTextless, ...FLYING, previous: NONE, template: "m20token" })).toBe("m20token");
  });

  it("without verified keys, names the target itself — the form checks it and says why it stays", () => {
    expect(followTokenHeight({ heightPinned: false, ...FLYING, previous: NONE, template: "m20token" })).toBe("m20tokentext");
    expect(followTokenHeight({ heightPinned: true, ...FLYING, previous: NONE, template: "m20token" })).toBe("m20token");
  });

  it("leaves every other frame alone (the arch, a showcase): round 11's pick owns the arch", () => {
    for (const template of ["m15token", "m15tokentext", "m15tokenartifact", "nyx", "m15"] as FrameTemplate[]) {
      expect(followTokenHeight({ ...base, ...LONG, previous: NONE, template }), template).toBe(template);
    }
  });
});

describe("pinsTokenHeight — which picks pin the height", () => {
  it("any full-art height picked in Variations pins — the one the text asks for too (owner decision 5: 'until the user picks a height')", () => {
    expect(pinsTokenHeight("m20tokentall", { variation: true })).toBe(true);
    expect(pinsTokenHeight("m20tokentext", { variation: true })).toBe(true);
    expect(pinsTokenHeight("m20token", { variation: true })).toBe(true);
    expect(pinsTokenHeight("m20tokenartifacttext", { variation: true })).toBe(true);
  });

  it("a Frame-section pick goes back to automatic, and a frame outside the family pins nothing here", () => {
    expect(pinsTokenHeight("m20token", { variation: false })).toBe(false);
    expect(pinsTokenHeight("m20tokentall", { variation: false })).toBe(false);
    expect(pinsTokenHeight("m15token", { variation: true })).toBe(false);
    expect(pinsTokenHeight("m15tokentext", { variation: true })).toBe(false);
  });
});

describe("the arch and the full-art family, side by side", () => {
  it("names the arch for its years (owner decision 2026-09-29) and the full-art design apart", () => {
    expect(FRAME_TEMPLATE_LABELS.m15token).toBe("Token (2014–2019)");
    expect(FRAME_TEMPLATE_LABELS.m15tokenartifact).toBe("Artifact Token (2014–2019)");
    expect(FRAME_TEMPLATE_LABELS.m15tokentext).toBe("Token (2014–2019), text box");
    for (const t of ALL_M20) expect(FRAME_TEMPLATE_LABELS[t as FrameTemplate], t).toMatch(/^Full-art (Artifact )?Token/);
  });

  it("each height's artifact template is its Artifact-word dress (4.50)", () => {
    expect(typeWordFrameFor("token", "m20token", "Artifact")).toBe("m20tokenartifact");
    expect(typeWordFrameFor("token", "m20tokentext", "Artifact Creature")).toBe("m20tokenartifacttext");
    expect(typeWordFrameFor("token", "m20tokentall", "Artifact")).toBe("m20tokenartifacttall");
    expect(typeWordFrameFor("token", "m20tokenartifacttall", "Creature")).toBe("m20tokentall");
  });
});
