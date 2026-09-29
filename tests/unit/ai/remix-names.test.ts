import { describe, expect, it } from "vitest";
import {
  REMIX_SECOND_NAME_MISSING,
  REMIX_SECOND_NAME_REUSED,
  applyRemixNames,
  remixSecondHalfLayout,
  renameSelfReferences,
  reusesSourceName,
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
  });

  it("a one-faced remix renames its own mentions too and carries no second half", () => {
    expect(
      applyRemixNames(
        { title: "Juggernaut", rules_text: "Juggernaut attacks each combat if able." },
        { title: "Iron Colossus", second_title: "Ignored" },
      ),
    ).toEqual({
      ok: true,
      title: "Iron Colossus",
      rules_text: "Iron Colossus attacks each combat if able.",
      back_face: undefined,
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
