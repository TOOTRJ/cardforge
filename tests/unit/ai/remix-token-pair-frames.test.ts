import { describe, expect, it } from "vitest";
import { ownCardRemixFrame, ownCardTextStandIn, remixCreditsOf, remixSavedFrames } from "@/lib/ai/remix-mechanics";
import { remixSavedFrame } from "@/lib/creator/frame-resolve";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import type { CardBackFace, ColorIdentity } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 5.5 (c), owner Round 78: a deck remix decides the frames it SAVES on —
// the front's and a double-sided token's back — BEFORE any picture is made.
// The latent failure: an own TEXTLESS full-art pair whose text heights are
// unticked. The AI writes flavour, remixSavedFrame moves the front to its
// stand-in (the arch), and the save's gate then refused the back (its arch
// isn't published in the back's colour) — after both pictures were paid for.
// Now: a back that can't follow the stand-in keeps the pair on its landing;
// a back that can't be saved at all fails the step before the art (refunded).
// The plan's price (ownCardRemixFrame → remixCreditsOf) and the step agree.
// ---------------------------------------------------------------------------

const keys = (...combos: [string, string][]) => new Set(combos.map(([t, k]) => frameComboKey(t as never, k)));

// A red Goblin // green Wolf on the full-art TEXTLESS design: the full-art
// textless token is published in both colours, its text heights in neither,
// and the arch only in red — the front's stand-in, but not the back's.
const VERIFIED = keys(["m20token", "r"], ["m20token", "g"], ["m15token", "r"], ["m15tokentext", "r"]);
const BACK: CardBackFace = {
  title: "Wolf",
  card_type: "token",
  supertype: "Creature",
  subtypes: ["Wolf"],
  power: "2",
  toughness: "2",
  color_identity: ["green"],
  frame_style: { template: "m20token" },
};
const SOURCE = {
  title: "Goblin",
  card_type: "token" as const,
  supertype: "Creature",
  subtypes: ["Goblin"],
  rules_text: null,
  color_identity: ["red"] as ColorIdentity[],
  frame_style: { template: "m20token" },
  back_face: { ...BACK, art_url: "https://x/back.png" },
};
const front = (verifiedKeys: ReadonlySet<string>, flavorText: string | null) => ({
  standIn: ownCardTextStandIn(SOURCE as never, verifiedKeys),
  template: "m20token" as const,
  cardType: "token" as const,
  supertype: "Creature",
  subtypes: ["Goblin"],
  rulesText: null,
  flavorText,
  power: "1",
  toughness: "1",
  colorIdentity: ["red"] as ColorIdentity[],
  verifiedKeys,
});

describe("remixSavedFrames: the frames decided before the art", () => {
  it("the plan prices the pair two pictures (the pair saves on its landing)", () => {
    const kept = ownCardRemixFrame(SOURCE as never, VERIFIED);
    expect(kept.frame_template).toBe("m20token");
    expect(kept.back_face?.frame_style).toEqual({ template: "m20token" });
    expect(remixCreditsOf(kept)).toBe(2);
  });

  it("the front alone would move to its arch stand-in once the AI writes flavour — where the green back can't follow", () => {
    expect(remixSavedFrame(front(VERIFIED, "A howl in the dark."))).toBe("m15tokentext");
  });

  it("…so the pair STAYS on its landing, and the step goes on to paint both faces", () => {
    expect(remixSavedFrames({ ...front(VERIFIED, "A howl in the dark."), back: BACK })).toEqual({ ok: true, template: "m20token" });
  });

  it("a back that can follow the stand-in moves with the front", () => {
    const withGreenArch = new Set([...VERIFIED, ...keys(["m15token", "g"])]);
    expect(remixSavedFrames({ ...front(withGreenArch, "A howl in the dark."), back: BACK })).toEqual({ ok: true, template: "m15tokentext" });
  });

  it("no flavour: the landing, as before", () => {
    expect(remixSavedFrames({ ...front(VERIFIED, null), back: BACK })).toEqual({ ok: true, template: "m20token" });
  });

  it("a back that can't be saved anywhere (a tick withdrawn since the plan) fails BEFORE the art — the plan would now price one face", () => {
    const noGreen = keys(["m20token", "r"], ["m15token", "r"], ["m15tokentext", "r"]);
    expect(remixSavedFrames({ ...front(noGreen, "A howl in the dark."), back: BACK })).toEqual({ ok: false });
    // The estimate and the reserve read ownCardRemixFrame: one face, one credit.
    const kept = ownCardRemixFrame(SOURCE as never, noGreen);
    expect([kept.back_face, remixCreditsOf(kept)]).toEqual([undefined, 1]);
  });

  it("every other card is remixSavedFrame's answer, unchanged", () => {
    for (const flavorText of [null, "A howl in the dark."]) {
      const input = front(VERIFIED, flavorText);
      expect(remixSavedFrames({ ...input, back: null })).toEqual({ ok: true, template: remixSavedFrame(input) });
    }
  });
});
