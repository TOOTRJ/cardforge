import { describe, expect, it } from "vitest";
import { scryfallCardSchema, type ScryfallCard } from "@/lib/scryfall/client";
import { mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import { importedAnatomy, newCardFrameStyle } from "@/lib/cards/anatomy";
import { crownKeyFor } from "@/lib/cards/crown";
import { getFrameProfile } from "@/lib/cards/template-layout";
import type { FrameTemplate } from "@/types/card";
import printings from "./fixtures/anatomy-printings.json";

// ---------------------------------------------------------------------------
// TODO 4.6a (+ 4.6b) — an import follows the printing, end to end, on the
// frames that draw the crown and the pairs (m15, m15artifact, m15land): the
// registry lands it exact,
// the card stores the printing's own crown switch (a crownless M15–RIX
// legendary stores `false`, so the new-card default never crowns it), a
// switch the printing says nothing about takes the new-card default (owner
// round 17, 2026-09-30: printing-only), and the renderers' rule draws the
// crown in the pinline of the master drawn.
// Fixtures: real Scryfall printings, trimmed (anatomy-printings.json).
// ---------------------------------------------------------------------------

const P = Object.fromEntries(
  Object.entries(printings).map(([key, raw]) => [key, scryfallCardSchema.parse(raw) as ScryfallCard]),
);

/** What the creator stores for an imported printing, and the crown it draws. */
function imported(key: string) {
  const patch = mapScryfallToFormPatch(P[key]);
  const template = patch.frame_match?.template as FrameTemplate;
  const anatomy = importedAnatomy(patch, template);
  const frameStyle = newCardFrameStyle({ template, ...anatomy.style }, patch.card_type);
  const crown = crownKeyFor(
    {
      colorIdentity: anatomy.colorIdentity ?? patch.color_identity,
      cost: patch.cost ?? null,
      cardType: patch.card_type ?? null,
      supertype: patch.supertype ?? null,
      frameStyle,
    },
    getFrameProfile(template),
  );
  return { match: patch.frame_match, frameStyle, crown };
}

describe("a crowned printing imports exact, crowned in its frame's pinline", () => {
  it.each([
    ["fdn-2", "m15", "w"], // Arahbo — mono white
    ["fdn-243", "m15", "m"], // Muldrotha — three colours: gold
    ["fdn-122", "m15", "wu"], // Kykar — a pair drawn as its pair master (4.6b): the split crown
    ["neo-268", "m15land", "w"], // Eiganjo — a land's crown is its colour
    ["uma-241", "m15land", "l"], // Dark Depths — a colourless land: the land grey
    ["fdn-677", "m15artifact", "a"], // Pyromancer's Goggles — a colourless artifact: the silver
    ["neo-74", "m15artifact", "u"], // The Reality Chip — a coloured artifact: its colour
  ])("%s → %s, crown %s", (key, template, crown) => {
    const got = imported(key);
    expect(got.match).toMatchObject({ template });
    // Every one is exact: m15 draws the pair too since 4.6b.
    expect(got.match).toMatchObject({ status: "exact" });
    expect(got.match?.gaps).toBeUndefined();
    // The crown follows the printing; the two-colour switch is the printing's
    // for Kykar (its own frame is split) and the new-card default for the
    // rest (printing-only, round 17) — on, but drawn only with a stored pair,
    // so a mono or three-colour card stays in its colour's frame.
    expect(got.frameStyle).toMatchObject({ template, crown: true, twoColor: true });
    expect(got.crown).toBe(crown);
  });
});

describe("a crownless printing imports without the crown", () => {
  it("an M15–RIX legendary (M15 #3 Avacyn) stores the switch off: no crown", () => {
    const got = imported("m15-3");
    expect(got.match).toMatchObject({ status: "exact", template: "m15" });
    expect(got.frameStyle).toEqual({ template: "m15", crown: false, twoColor: true, collector: "2015" });
    expect(got.crown).toBeNull();
  });

  it("a showcase printing (LTR #302 ring) stores the switch off where it lands on a crowned frame", () => {
    const patch = mapScryfallToFormPatch(P["ltr-302"]);
    expect(patch.printed_crown).toBe(false);
    expect(newCardFrameStyle({ template: "m15", ...importedAnatomy(patch, "m15").style }, "creature")).toMatchObject({ crown: false });
  });

  it("a Multiverse Legends etched printing (MUL #66) lands on m15 without the crown its frame never printed", () => {
    const got = imported("mul-66");
    expect(got.match).toMatchObject({ status: "nearest", template: "m15", signature: "showcase/mul" });
    expect(got.frameStyle).toEqual({ template: "m15", crown: false, twoColor: true, collector: "2023" });
    expect(got.crown).toBeNull();
  });
});
