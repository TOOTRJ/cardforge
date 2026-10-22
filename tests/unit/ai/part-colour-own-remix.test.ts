import { describe, expect, it } from "vitest";
import { ownCardRemixFrame, type OwnCardRemixSource } from "@/lib/ai/remix-mechanics";
import { mapScryfallBackFacePatch } from "@/lib/scryfall/import-mapper";
import type { ScryfallCard } from "@/lib/scryfall/client";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.26, M1 — the AI deck remix of the user's OWN two-part card keeps
// its frame with each part in its own colour only where both parts'
// colours are verified on it; else the look goes OFF (`part_color_off`) and
// the frame is judged in the card's whole colour, as before 4.26 — never a
// save the gate refuses after the art. And L1: a Room names no part colour.
// ---------------------------------------------------------------------------

const ALL = new Set(FRAME_TEMPLATE_VALUES.flatMap((t) => ["w", "u", "b", "r", "g", "m", "c"].map((k) => `${t}/${k}`)));
const without = (...keys: string[]) => new Set([...ALL].filter((k) => !keys.includes(k)));

const fireIce = (frameStyle: Record<string, unknown>): OwnCardRemixSource =>
  ({
    title: "Fire",
    card_type: "instant",
    supertype: null,
    subtypes: [],
    rules_text: "Fire deals 2 damage divided as you choose among one or two targets.",
    // M2: the card's colour is the whole card's; Fire's red is the frame's.
    color_identity: ["multicolor"],
    frame_style: { template: "split", finish: "regular", ...frameStyle },
    back_face: { title: "Ice", cost: "{1}{U}", card_type: "instant", color_identity: ["blue"] },
  }) as unknown as OwnCardRemixSource;

describe("an own split card's remix", () => {
  it("keeps the frame in the first part's colour where both parts are verified (the gold need not be)", () => {
    const kept = ownCardRemixFrame(fireIce({ partColor: true, firstPartColor: ["red"] }), without("split/m"));
    expect(kept.frame_template).toBe("split");
    expect(kept.part_color_off).toBeUndefined();
    expect(kept.back_face?.color_identity).toEqual(["blue"]);
  });

  it("a part's colour not verified: the look OFF, the frame judged in the whole colour", () => {
    const off = ownCardRemixFrame(fireIce({ partColor: true, firstPartColor: ["red"] }), without("split/u"));
    expect(off).toMatchObject({ frame_template: "split", part_color_off: true });
    // …and neither the part nor the gold: no template, the default landing
    // (as before 4.26).
    expect(ownCardRemixFrame(fireIce({ partColor: true, firstPartColor: ["red"] }), without("split/u", "split/m"))).toEqual({});
  });

  it("a card stored with the look off keeps it off and is judged as main judged it", () => {
    expect(ownCardRemixFrame(fireIce({ partColor: false }), without("split/u"))).toEqual(
      expect.objectContaining({ frame_template: "split" }),
    );
    expect(ownCardRemixFrame(fireIce({ partColor: false }), without("split/u")).part_color_off).toBeUndefined();
  });
});

describe("L1: a Room names no part colour", () => {
  it("leaves back_face.color_identity off a Room's second door", () => {
    const room = {
      object: "card",
      id: "00000000-0000-4000-8000-000000000001",
      name: "Secret Arcade // Dusty Parlor",
      layout: "split",
      type_line: "Enchantment — Room // Enchantment — Room",
      card_faces: [
        { name: "Secret Arcade", mana_cost: "{4}{W}", type_line: "Enchantment — Room", oracle_text: "…" },
        { name: "Dusty Parlor", mana_cost: "{2}{W}", type_line: "Enchantment — Room", oracle_text: "…" },
      ],
    } as unknown as ScryfallCard;
    expect(mapScryfallBackFacePatch(room)?.color_identity).toBeUndefined();
    // …where a split card's second half names its own.
    const split = { ...room, type_line: "Instant // Instant", card_faces: [
      { name: "Fire", mana_cost: "{1}{R}", type_line: "Instant", oracle_text: "…" },
      { name: "Ice", mana_cost: "{1}{U}", type_line: "Instant", oracle_text: "…" },
    ] } as unknown as ScryfallCard;
    expect(mapScryfallBackFacePatch(split)?.color_identity).toEqual(["blue"]);
  });
});
