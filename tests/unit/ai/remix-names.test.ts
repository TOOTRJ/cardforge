import { describe, expect, it } from "vitest";
import {
  REMIX_NAME_REUSED,
  REMIX_SECOND_NAME_MISSING,
  REMIX_SECOND_NAME_REUSED,
  applyRemixNames,
  remixSecondHalfLayout,
  renameSelfReferences,
  reusesSourceName,
  shortNameOf,
} from "@/lib/ai/remix-names";
import { backFaceSchema } from "@/lib/validation/card";
import printings from "../scryfall/fixtures/import-printings.json";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import { mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import { scryfallRemixMechanics } from "@/lib/ai/remix-mechanics";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import type { CardBackFace, FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// Owner decision B3 (2026-09-29): an AI deck remix of a two-part layout card
// renames BOTH halves, and the two names read as one card. It used to name
// the front only, so Bonecrusher Giant // Stomp became "<new name> // Stomp"
// — a real card's name printed on the remix. The rules text keeps its
// mechanics and follows the new names.
// ---------------------------------------------------------------------------

describe("remixSecondHalfLayout — which layouts carry a second half to name", () => {
  it("names the four layout frames that paint a second half", () => {
    expect(remixSecondHalfLayout("adventure")).toBe("adventure");
    expect(remixSecondHalfLayout("split")).toBe("split");
    expect(remixSecondHalfLayout("aftermath")).toBe("aftermath");
    expect(remixSecondHalfLayout("flip")).toBe("flip");
  });

  it("is null for a frame with no second half (a standard frame, the saga rail)", () => {
    expect(remixSecondHalfLayout("m15")).toBeNull();
    expect(remixSecondHalfLayout("saga")).toBeNull();
    expect(remixSecondHalfLayout(undefined)).toBeNull();
  });
});

describe("shortNameOf — the name rules text calls a card by", () => {
  it("is the part before the comma", () => {
    expect(shortNameOf("Dokai, Weaver of Life")).toBe("Dokai");
    expect(shortNameOf("Dokai, Weaver of Life", "Legendary")).toBe("Dokai");
  });

  it("is the one word before ' the ' on a legendary face only", () => {
    // Scryfall's oracle: "Goka deals 4 damage", "Remove a ki counter from Jaraku".
    expect(shortNameOf("Goka the Unjust", "Legendary")).toBe("Goka");
    expect(shortNameOf("Jaraku the Interloper", "Legendary")).toBe("Jaraku");
    expect(shortNameOf("Goka the Unjust")).toBeNull();
    // Not a proper name: the full name is what the rules text uses.
    expect(shortNameOf("Kodama of the North Tree", "Legendary")).toBeNull();
    expect(shortNameOf("Curse of the Fire Penguin")).toBeNull();
    expect(shortNameOf("The Ur-Dragon", "Legendary")).toBeNull();
  });

  it("is null for a plain name or one shorter than 3 characters", () => {
    expect(shortNameOf("Bonecrusher Giant")).toBeNull();
    expect(shortNameOf("Xi, the Wanderer", "Legendary")).toBeNull();
  });
});

describe("renameSelfReferences", () => {
  it("replaces every whole-word mention of the old name", () => {
    expect(
      renameSelfReferences(
        "Juggernaut attacks each combat if able. Juggernaut can't be blocked by Walls.",
        [["Juggernaut", "Iron Colossus"]],
      ),
    ).toBe("Iron Colossus attacks each combat if able. Iron Colossus can't be blocked by Walls.");
  });

  it("follows a possessive and leaves longer words and other cases alone", () => {
    expect(
      renameSelfReferences("Fire's damage can't be prevented. Firebolt and fire are not Fire.", [
        ["Fire", "Ember"],
      ]),
    ).toBe("Ember's damage can't be prevented. Firebolt and fire are not Ember.");
  });

  it("never re-scans a new name that contains the old one", () => {
    expect(renameSelfReferences("Stomp deals 2 damage.", [["Stomp", "Stomp of Ages"]])).toBe(
      "Stomp of Ages deals 2 damage.",
    );
  });

  it("matches the longest name first when one name contains another", () => {
    expect(
      renameSelfReferences("Flip Budoka Gardener. Budoka stays.", [
        ["Budoka", "Sela"],
        ["Budoka Gardener", "Grove Tender"],
      ]),
    ).toBe("Flip Grove Tender. Sela stays.");
  });

  it("returns the text untouched with nothing to rename", () => {
    expect(renameSelfReferences("Draw a card.", [])).toBe("Draw a card.");
    expect(renameSelfReferences(undefined, [["A", "B"]])).toBeUndefined();
  });
});

const stomp: CardBackFace = {
  title: "Stomp",
  cost: "{1}{R}",
  card_type: "instant",
  subtypes: ["Adventure"],
  rules_text: "Damage can't be prevented this turn. Stomp deals 2 damage to any target.",
};

describe("applyRemixNames — both halves renamed", () => {
  it("writes the identity's names on both halves and the rules text follows them", () => {
    const named = applyRemixNames(
      {
        title: "Bonecrusher Giant",
        rules_text:
          "Whenever Bonecrusher Giant becomes the target of a spell, Bonecrusher Giant deals 2 damage to that spell's controller.",
        back_face: stomp,
      },
      { title: "Crag Titan", second_title: "Quake", second_flavor_text: "Unused." },
    );
    expect(named).toEqual({
      ok: true,
      title: "Crag Titan",
      rules_text:
        "Whenever Crag Titan becomes the target of a spell, Crag Titan deals 2 damage to that spell's controller.",
      back_face: {
        ...stomp,
        title: "Quake",
        rules_text: "Damage can't be prevented this turn. Quake deals 2 damage to any target.",
        // The printing's half had no flavour, so the half gets none.
        flavor_text: undefined,
      },
    });
    if (named.ok) expect(backFaceSchema.safeParse(named.back_face).success).toBe(true);
  });

  it("each half's text follows either rename (a flip's front names its flipped self)", () => {
    const named = applyRemixNames(
      {
        title: "Budoka Gardener",
        rules_text: "If you control ten or more lands, flip Budoka Gardener.",
        back_face: {
          title: "Dokai, Weaver of Life",
          card_type: "creature",
          supertype: "Legendary",
          rules_text: "Dokai's tokens are Elementals. Budoka Gardener was here.",
        },
      },
      { title: "Grove Tender", second_title: "Sela, Voice of Roots" },
    );
    expect(named.ok && named.rules_text).toBe("If you control ten or more lands, flip Grove Tender.");
    // A legendary's short name follows its new short name.
    expect(named.ok && named.back_face?.rules_text).toBe(
      "Sela's tokens are Elementals. Grove Tender was here.",
    );
  });

  it("rewrites the second half's flavour only where the source half had one", () => {
    const named = applyRemixNames(
      { title: "Commit", back_face: { title: "Memory", flavor_text: "Old words." } },
      { title: "Bind", second_title: "Recall", second_flavor_text: "New words." },
    );
    expect(named.ok && named.back_face?.flavor_text).toBe("New words.");
    const dropped = applyRemixNames(
      { title: "Commit", back_face: { title: "Memory", flavor_text: "Old words." } },
      { title: "Bind", second_title: "Recall", second_flavor_text: null },
    );
    // Never the printing's own flavour on a renamed half.
    expect(dropped.ok && dropped.back_face?.flavor_text).toBeUndefined();
  });

  it("fails rather than ship the source's name when the second name is missing", () => {
    for (const second_title of [undefined, null, "  "]) {
      expect(
        applyRemixNames({ title: "Bonecrusher Giant", back_face: stomp }, { title: "Crag Titan", second_title }),
      ).toEqual({ ok: false, error: REMIX_SECOND_NAME_MISSING });
    }
  });

  it("fails when the second half keeps its original name or a legendary's own name", () => {
    // Seen in a live run (2026-09-28): "Dokai, Weaver of Life" → "Dokai, Lifebringer".
    const flipSource = {
      title: "Budoka Gardener",
      back_face: { title: "Dokai, Weaver of Life", supertype: "Legendary" },
    };
    expect(
      applyRemixNames(flipSource, { title: "Grove Tender", second_title: "Dokai, Lifebringer" }),
    ).toEqual({ ok: false, error: REMIX_SECOND_NAME_REUSED });
    expect(
      applyRemixNames({ title: "Bonecrusher Giant", back_face: stomp }, { title: "Crag Titan", second_title: "stomp" }),
    ).toEqual({ ok: false, error: REMIX_SECOND_NAME_REUSED });
    // A new name that merely contains the letters is fine.
    expect(reusesSourceName("Dokaiya, Root Singer", "Dokai, Weaver of Life")).toBe(false);
    expect(reusesSourceName("Stomping Ground Rite", "Stomp")).toBe(false);
    // A legendary "X the Y" keeps X: "Goka the Unjust" → "Goka the Merciful".
    expect(reusesSourceName("Goka the Merciful", "Goka the Unjust", "Legendary")).toBe(true);
    expect(reusesSourceName("Goka the Merciful", "Goka the Unjust")).toBe(false);
  });

  // Every new name is held to EVERY original name, the list the prompt
  // reserves — the live run kept a legendary's own name under the prompt ban.
  const kuon = {
    title: "Kuon, Ogre Ascendant",
    supertype: "Legendary",
    rules_text:
      "At the beginning of the end step, if three or more creatures died this turn, flip Kuon.",
    back_face: {
      title: "Kuon's Essence",
      card_type: "enchantment" as const,
      supertype: "Legendary",
      rules_text:
        "At the beginning of each player's upkeep, that player sacrifices a creature of their choice.",
    },
  };

  it("fails when either half keeps the OTHER half's original name (CHK flip, swapped split)", () => {
    // The second half keeps the front's own name ("Kuon").
    expect(
      applyRemixNames(kuon, { title: "Mira, Sky Ascendant", second_title: "Kuon's Echo" }),
    ).toEqual({ ok: false, error: REMIX_SECOND_NAME_REUSED });
    // The front keeps its own legendary name.
    expect(
      applyRemixNames(kuon, { title: "Kuon, Storm Ascendant", second_title: "Mira's Essence" }),
    ).toEqual({ ok: false, error: REMIX_NAME_REUSED });
    // A swapped split card prints both real names.
    expect(
      applyRemixNames(
        { title: "Fire", back_face: { title: "Ice", card_type: "instant" } },
        { title: "Ice", second_title: "Fire" },
      ),
    ).toMatchObject({ ok: false });
    // Renamed coherently, it passes and the text follows.
    const named = applyRemixNames(kuon, { title: "Mira, Sky Ascendant", second_title: "Mira's Essence" });
    expect(named).toMatchObject({
      ok: true,
      title: "Mira, Sky Ascendant",
      rules_text:
        "At the beginning of the end step, if three or more creatures died this turn, flip Mira.",
      back_face: { title: "Mira's Essence" },
    });
  });

  it("a legendary 'X the Y' half's short name follows its new one (Initiate of Blood // Goka the Unjust)", () => {
    // Scryfall's current oracle (2026-09-28).
    const initiate = {
      title: "Initiate of Blood",
      rules_text:
        "{T}: This creature deals 1 damage to target creature that was dealt damage this turn. When that creature dies this turn, flip this creature.",
      back_face: {
        title: "Goka the Unjust",
        card_type: "creature" as const,
        supertype: "Legendary",
        rules_text: "{T}: Goka deals 4 damage to target creature that was dealt damage this turn.",
      },
    };
    const named = applyRemixNames(initiate, { title: "Ember Acolyte", second_title: "Vorn the Cruel" });
    expect(named.ok && named.back_face?.rules_text).toBe(
      "{T}: Vorn deals 4 damage to target creature that was dealt damage this turn.",
    );
    const plain = applyRemixNames(initiate, { title: "Ember Acolyte", second_title: "Stormcaller Vorn" });
    expect(plain.ok && plain.back_face?.rules_text).toBe(
      "{T}: Stormcaller Vorn deals 4 damage to target creature that was dealt damage this turn.",
    );
    expect(
      applyRemixNames(initiate, { title: "Ember Acolyte", second_title: "Goka the Merciful" }),
    ).toEqual({ ok: false, error: REMIX_SECOND_NAME_REUSED });
    // The same on a legendary FRONT (here one-faced).
    const front = applyRemixNames(
      { title: "Goka the Unjust", supertype: "Legendary", rules_text: initiate.back_face.rules_text },
      { title: "Vorn the Cruel" },
    );
    expect(front.ok && front.rules_text).toBe(
      "{T}: Vorn deals 4 damage to target creature that was dealt damage this turn.",
    );
  });

  it("a one-faced remix renames its own mentions too and carries no second half", () => {
    // Scryfall's current oracle (2026-09-28): a spell still names itself; a
    // non-legendary permanent says "this creature" (Juggernaut LEA: "This
    // creature attacks each combat if able."), so it has nothing to rename.
    expect(
      applyRemixNames(
        { title: "Lightning Bolt", rules_text: "Lightning Bolt deals 3 damage to any target." },
        { title: "Storm Lance", second_title: "Ignored" },
      ),
    ).toEqual({
      ok: true,
      title: "Storm Lance",
      rules_text: "Storm Lance deals 3 damage to any target.",
      back_face: undefined,
    });
    expect(
      applyRemixNames(
        { title: "Juggernaut", rules_text: "This creature attacks each combat if able." },
        { title: "Iron Colossus" },
      ),
    ).toMatchObject({ ok: true, rules_text: "This creature attacks each combat if able." });
  });

  it("a one-faced remix is not guarded: its naming is what it was before B3", () => {
    // Ragavan's current oracle calls it "Ragavan"; a new name keeping it is
    // not refused on a one-faced card (the guard is two-part only).
    expect(
      applyRemixNames(
        {
          title: "Ragavan, Nimble Pilferer",
          supertype: "Legendary",
          rules_text: "Whenever Ragavan deals combat damage to a player, create a Treasure token.",
        },
        { title: "Ragavan, Neon Thief" },
      ),
    ).toMatchObject({
      ok: true,
      title: "Ragavan, Neon Thief",
      rules_text: "Whenever Ragavan deals combat damage to a player, create a Treasure token.",
    });
  });

  it("leaves a one-word name that is also a rules word alone (Exile is a real card)", () => {
    const named = applyRemixNames(
      { title: "Exile", rules_text: "Exile target nonwhite attacking creature." },
      { title: "Banishment" },
    );
    expect(named.ok && named.rules_text).toBe("Exile target nonwhite attacking creature.");
  });
});

// ---------------------------------------------------------------------------
// End to end on real (trimmed) printings: the four two-part layouts, landed
// on their own frame, carry a second half the identity names.
// ---------------------------------------------------------------------------

const everyColour = (...templates: string[]) =>
  new Set(
    templates.flatMap((t) =>
      ["w", "u", "b", "r", "g", "c", "m"].map((k) => frameComboKey(t as FrameTemplate, k)),
    ),
  );

describe("the remix's two-part printings get both halves renamed", () => {
  const cases = [
    ["eld-115", "adventure", "Stomp"],
    ["dmr-215", "split", "Ice"],
    ["akh-211", "aftermath", "Memory"],
    ["chk-202", "flip", "Dokai, Weaver of Life"],
  ] as const;

  for (const [key, layout, secondName] of cases) {
    it(`${key} (${layout}): the second half "${secondName}" is renamed`, () => {
      const patch = mapScryfallToFormPatch(scryfallCardSchema.parse(printings[key]));
      const result = scryfallRemixMechanics(patch, "Entry", everyColour(layout, "m15"));
      if (!result.ok) throw new Error(result.error);
      const m = result.mechanics;
      expect(m.frame_template).toBe(layout);
      expect(m.back_face?.title).toBe(secondName);
      expect(remixSecondHalfLayout(m.frame_template)).toBe(layout);

      const named = applyRemixNames(m, { title: "New Front", second_title: "New Back" });
      if (!named.ok) throw new Error(named.error);
      expect(named.title).toBe("New Front");
      expect(named.back_face?.title).toBe("New Back");
      expect(backFaceSchema.safeParse(named.back_face).success).toBe(true);
    });
  }

  it("a layout card that fell back to a standard frame has one face and one name", () => {
    const patch = mapScryfallToFormPatch(scryfallCardSchema.parse(printings["eld-115"]));
    const result = scryfallRemixMechanics(patch, "Entry", everyColour("m15"));
    if (!result.ok) throw new Error(result.error);
    expect(result.mechanics.frame_template).toBe("m15");
    expect(result.mechanics.back_face).toBeUndefined();
    expect(remixSecondHalfLayout(result.mechanics.frame_template)).toBeNull();
  });
});
