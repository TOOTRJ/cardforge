import { describe, expect, it } from "vitest";
import { createCardSchema, frameStyleSchema, updateCardSchema } from "@/lib/validation/card";
import { REVISABLE_PAYLOAD_KEYS, frameAnatomyPatchFor, pickRevisablePayload } from "@/lib/creator/revise";
import type { FormValues } from "@/lib/creator/form-types";

// ---------------------------------------------------------------------------
// TODO 4.6.0 — the anatomy switches in the shared zod schemas (client and
// server): frame_style.crown / frame_style.twoColor are booleans, optional
// (absent = off, the look every stored card has), and frame_style stays
// strict. An EDIT carries them on its own key (`frame_anatomy`) — edits
// never send frame_style — with at most a colour pair for a multicolour
// card whose owner switches the two-colour frame on.
// ---------------------------------------------------------------------------

const GAME = "22222222-2222-4222-8222-222222222222";

describe("frame_style's anatomy switches", () => {
  it("accepts true, false and absent", () => {
    for (const style of [
      { template: "m15", crown: true, twoColor: true },
      { template: "m15", crown: false, twoColor: false },
      { template: "m15", finish: "foil" },
      {},
    ]) {
      expect(frameStyleSchema.safeParse(style).success, JSON.stringify(style)).toBe(true);
    }
    expect(frameStyleSchema.parse({ template: "m15", crown: true })).toEqual({ template: "m15", crown: true });
  });

  it("rejects anything but a boolean, and any other key (the schema stays strict)", () => {
    for (const style of [
      { template: "m15", crown: "yes" },
      { template: "m15", twoColor: 1 },
      { template: "m15", crown: null },
      { template: "m15", twocolor: true },
      { template: "m15", pair: ["white", "blue"] },
    ]) {
      expect(frameStyleSchema.safeParse(style).success, JSON.stringify(style)).toBe(false);
    }
  });

  it("rides a create payload", () => {
    const parsed = createCardSchema.parse({
      title: "Aurelian Tidewright",
      game_system_id: GAME,
      color_identity: ["white", "blue"],
      frame_style: { template: "m15", finish: "regular", crown: true, twoColor: false },
    });
    expect(parsed.frame_style).toEqual({ template: "m15", finish: "regular", crown: true, twoColor: false });
    expect(parsed.color_identity).toEqual(["white", "blue"]);
  });
});

describe("an edit's frame_anatomy", () => {
  it("accepts the switches and a confirmed pair with the two-colour frame on", () => {
    for (const patch of [
      { crown: true },
      { twoColor: false },
      { crown: false, twoColor: true },
      { twoColor: true, pair: ["white", "blue"] },
    ]) {
      expect(updateCardSchema.safeParse({ frame_anatomy: patch }).success, JSON.stringify(patch)).toBe(true);
    }
  });

  it("refuses a pair without the switch, a pair of one colour, a non-WUBRG pair and unknown keys", () => {
    for (const patch of [
      { pair: ["white", "blue"] },
      { twoColor: false, pair: ["white", "blue"] },
      { twoColor: true, pair: ["white", "white"] },
      { twoColor: true, pair: ["white", "multicolor"] },
      { twoColor: true, pair: ["white"] },
      { crown: "on" },
      { template: "m15" },
    ]) {
      expect(updateCardSchema.safeParse({ frame_anatomy: patch }).success, JSON.stringify(patch)).toBe(false);
    }
  });

  it("is a revisable payload key: an edit keeps it, and never frame_style", () => {
    expect(REVISABLE_PAYLOAD_KEYS).toContain("frame_anatomy");
    const picked = pickRevisablePayload({
      title: "Renamed",
      frame_style: { template: "m15", crown: true },
      color_identity: ["white", "blue"],
      frame_anatomy: { crown: true },
    });
    expect(picked).toEqual({ title: "Renamed", frame_anatomy: { crown: true } });
  });
});

describe("what an edit sends (frameAnatomyPatchFor)", () => {
  const values = (frame_style: FormValues["frame_style"], color_identity: FormValues["color_identity"]) =>
    ({ frame_style, color_identity }) as Pick<FormValues, "frame_style" | "color_identity">;

  it("nothing for an ordinary edit — a stored card keeps its frame_style exactly", () => {
    expect(frameAnatomyPatchFor({ frame_style: { template: "m15" }, color_identity: ["red"] }, values({ template: "m15" }, ["red"]))).toBeUndefined();
    expect(
      frameAnatomyPatchFor(
        { frame_style: { template: "m15", crown: true }, color_identity: ["red"] },
        values({ template: "m15", crown: true }, ["red"]),
      ),
    ).toBeUndefined();
  });

  it("each switch the owner changed", () => {
    expect(
      frameAnatomyPatchFor({ frame_style: { template: "m15" }, color_identity: ["red"] }, values({ template: "m15", crown: true }, ["red"])),
    ).toEqual({ crown: true });
    expect(
      frameAnatomyPatchFor(
        { frame_style: { template: "m15", crown: true }, color_identity: ["red"] },
        values({ template: "m15", crown: false }, ["red"]),
      ),
    ).toEqual({ crown: false });
  });

  it("the pair a stored multicolour card was given, with the switch that needs it", () => {
    expect(
      frameAnatomyPatchFor(
        { frame_style: { template: "m15" }, color_identity: ["multicolor"] },
        values({ template: "m15", twoColor: true }, ["white", "blue"]),
      ),
    ).toEqual({ twoColor: true, pair: ["white", "blue"] });
    // A stored pair is never re-sent.
    expect(
      frameAnatomyPatchFor(
        { frame_style: { template: "m15" }, color_identity: ["white", "blue"] },
        values({ template: "m15", twoColor: true }, ["white", "blue"]),
      ),
    ).toEqual({ twoColor: true });
    // No pair without the switch.
    expect(
      frameAnatomyPatchFor(
        { frame_style: { template: "m15" }, color_identity: ["multicolor"] },
        values({ template: "m15" }, ["white", "blue"]),
      ),
    ).toBeUndefined();
  });
});
