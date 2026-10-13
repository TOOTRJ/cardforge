import { describe, expect, it } from "vitest";
import { frameKindGateError } from "@/lib/cards/frame-kind-gate";
import {
  CARD_KIND_VALUES,
  framesForKind,
  isSubtypeDress,
  subtypeDressOf,
  subtypeFrameFits,
  subtypeFrameFor,
  templateRefusesKind,
} from "@/lib/creator/card-kinds";
import { FRAME_COLOR_KEYS, frameComboKey } from "@/lib/cards/frame-reference-registry";
import { resolveGeneratedFrame } from "@/lib/creator/frame-random";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// The station frame (TODO 4.27a) — `m15station`, a Spacecraft's, and
// `m15stationland`, a Planet's: stored templates of their own, as the Vehicle
// frame is (tests/unit/creator/vehicle-frame.test.ts). This file holds the
// GATE: which card each dresses (its subtype, its kind) and where the subtype
// sends a card between a base frame and its dresses — the artifact frame has
// two now (Vehicle, Spacecraft), the land frame one (Planet).
// ---------------------------------------------------------------------------

const EVERY: ReadonlySet<string> = new Set(FRAME_TEMPLATE_VALUES.flatMap((t) => FRAME_COLOR_KEYS.map((k) => frameComboKey(t, k))));

describe("the station frame's subtype", () => {
  it("m15station dresses a Spacecraft, m15stationland a Planet — nothing else", () => {
    expect(subtypeDressOf("m15station")).toBe("Spacecraft");
    expect(subtypeDressOf("m15stationland")).toBe("Planet");
    expect(isSubtypeDress("m15station")).toBe(true);
    expect(isSubtypeDress("m15stationland")).toBe(true);

    expect(subtypeFrameFits("m15station", ["Spacecraft"])).toBe(true);
    expect(subtypeFrameFits("m15station", [" spacecraft "])).toBe(true);
    expect(subtypeFrameFits("m15station", ["Vehicle"])).toBe(false);
    expect(subtypeFrameFits("m15station", ["Planet"])).toBe(false);
    expect(subtypeFrameFits("m15station", [])).toBe(false);
    expect(subtypeFrameFits("m15station", null)).toBe(false);

    expect(subtypeFrameFits("m15stationland", ["Planet"])).toBe(true);
    expect(subtypeFrameFits("m15stationland", ["Spacecraft"])).toBe(false);
    expect(subtypeFrameFits("m15stationland", ["Forest"])).toBe(false);
    expect(subtypeFrameFits("m15stationland", [])).toBe(false);
    // The Vehicle frame still takes no Spacecraft.
    expect(subtypeFrameFits("m15vehicle", ["Spacecraft"])).toBe(false);
  });
});

describe("the station frame's kind", () => {
  it("m15station dresses the Artifact kind only, m15stationland the Land kind only", () => {
    expect(CARD_KIND_VALUES.filter((kind) => !templateRefusesKind("m15station", kind))).toEqual(["artifact"]);
    expect(CARD_KIND_VALUES.filter((kind) => !templateRefusesKind("m15stationland", kind))).toEqual(["land"]);
    for (const kind of CARD_KIND_VALUES) {
      const offered = framesForKind(kind, EVERY).map((f) => f.template);
      expect(offered.includes("m15station"), kind).toBe(kind === "artifact");
      expect(offered.includes("m15stationland"), kind).toBe(kind === "land");
    }
  });

  it("the server's gate reads both halves: the kind, then the subtype", () => {
    const ship = { cardType: "artifact", subtypes: ["Spacecraft"], title: "Lumen-Class Frigate" };
    const planet = { cardType: "land", subtypes: ["Planet"], title: "Evendo, Waking Haven" };
    expect(frameKindGateError("m15station", ship)).toBeNull();
    expect(frameKindGateError("m15stationland", planet)).toBeNull();
    // The wrong subtype on the right kind. (The copy's plural is not pinned
    // here: subtypeDressReason adds an "s", and the plural of Spacecraft is
    // Spacecraft.)
    expect(frameKindGateError("m15station", { ...ship, subtypes: ["Vehicle"] })).toMatch(/^The Spacecraft frame is for Spacecraft/);
    expect(frameKindGateError("m15stationland", { ...planet, subtypes: ["Forest"] })).toBe("The Planet frame is for Planets — pick another frame.");
    // The right subtype on the wrong kind.
    expect(frameKindGateError("m15station", { ...planet, subtypes: ["Spacecraft"] })).toMatch(/doesn't dress Land cards/);
    expect(frameKindGateError("m15stationland", { ...ship, subtypes: ["Planet"] })).toMatch(/doesn't dress Artifact cards/);
    expect(frameKindGateError("m15station", { cardType: "creature", subtypes: ["Spacecraft"], title: "x" })).toMatch(/doesn't dress Creature cards/);
  });
});

describe("where the subtype sends a card (subtypeFrameFor)", () => {
  it("the artifact frame and its two dresses", () => {
    // The Vehicle's half is unchanged by the second dress.
    expect(subtypeFrameFor("m15artifact", ["Vehicle"])).toBe("m15vehicle");
    expect(subtypeFrameFor("m15vehicle", ["Vehicle"])).toBe("m15vehicle");
    expect(subtypeFrameFor("m15vehicle", [])).toBe("m15artifact");
    // The Spacecraft's.
    expect(subtypeFrameFor("m15artifact", ["Spacecraft"])).toBe("m15station");
    expect(subtypeFrameFor("m15station", ["Spacecraft"])).toBe("m15station");
    expect(subtypeFrameFor("m15station", [])).toBe("m15artifact");
    // Between the two dresses.
    expect(subtypeFrameFor("m15vehicle", ["Spacecraft"])).toBe("m15station");
    expect(subtypeFrameFor("m15station", ["Vehicle"])).toBe("m15vehicle");
    // No dress's subtype: the base.
    expect(subtypeFrameFor("m15artifact", ["Equipment"])).toBe("m15artifact");
    expect(subtypeFrameFor("m15artifact", null)).toBe("m15artifact");
  });

  it("the land frame and its one dress", () => {
    expect(subtypeFrameFor("m15land", ["Planet"])).toBe("m15stationland");
    expect(subtypeFrameFor("m15stationland", ["Planet"])).toBe("m15stationland");
    expect(subtypeFrameFor("m15stationland", ["Forest"])).toBe("m15land");
    expect(subtypeFrameFor("m15stationland", [])).toBe("m15land");
    expect(subtypeFrameFor("m15land", ["Forest"])).toBe("m15land");
    // A land never follows an artifact's subtype, nor an artifact a land's.
    expect(subtypeFrameFor("m15land", ["Spacecraft"])).toBe("m15land");
    expect(subtypeFrameFor("m15artifact", ["Planet"])).toBe("m15artifact");
  });

  it("returns every other template unchanged, whatever the subtype", () => {
    const families = ["m15artifact", "m15vehicle", "m15station", "m15land", "m15stationland"];
    for (const t of FRAME_TEMPLATE_VALUES) {
      if (families.includes(t)) continue;
      for (const subtypes of [["Spacecraft"], ["Planet"], ["Vehicle"], []]) {
        expect(subtypeFrameFor(t, subtypes), `${t} ${subtypes.join()}`).toBe(t);
      }
    }
  });
});

// The independent check of #543: with the station frame as the artifact
// frame's second dress, a Vehicle retyped as a Spacecraft was sent to the
// station frame — unpublished — so the creator's follow effect did nothing
// and the card stayed on the Vehicle frame, which the server refuses for
// it. Before the station frame existed it went back to the Artifact frame.
describe("a dress the card cannot wear yet is never where the subtype sends it", () => {
  const published =
    (...templates: string[]) =>
    (dress: string) =>
      templates.includes(dress);

  it("an unpublished dress gives way to the base — the Vehicle's half as it was before the second dress", () => {
    // Production today: the Vehicle frame is ticked, the station frame is not.
    const today = published("m15vehicle");
    expect(subtypeFrameFor("m15vehicle", ["Spacecraft"], today)).toBe("m15artifact");
    expect(subtypeFrameFor("m15artifact", ["Spacecraft"], today)).toBe("m15artifact");
    expect(subtypeFrameFor("m15artifact", ["Vehicle"], today)).toBe("m15vehicle");
    expect(subtypeFrameFor("m15vehicle", ["Vehicle"], today)).toBe("m15vehicle");
    expect(subtypeFrameFor("m15vehicle", [], today)).toBe("m15artifact");
    expect(subtypeFrameFor("m15land", ["Planet"], today)).toBe("m15land");
    // Once it is ticked the subtype sends the card there.
    const later = published("m15vehicle", "m15station", "m15stationland");
    expect(subtypeFrameFor("m15vehicle", ["Spacecraft"], later)).toBe("m15station");
    expect(subtypeFrameFor("m15land", ["Planet"], later)).toBe("m15stationland");
    // The base is never tested: a card leaving a dress always has it.
    expect(subtypeFrameFor("m15station", [], published())).toBe("m15artifact");
  });

  it("a generated Spacecraft asked for on the Vehicle frame lands on the Artifact frame while the station frame is unpublished", () => {
    const keys = (...pairs: [string, string][]) => new Set(pairs.map(([t, k]) => frameComboKey(t as never, k as never)));
    const ship = { cardType: "artifact", subtypes: ["Spacecraft"], title: "Lumen-Class Frigate", power: "3", toughness: "5" };
    const today = keys(["m15artifact", "c"], ["m15vehicle", "c"]);
    for (const requested of ["m15vehicle", "m15artifact", "m15station"] as const) {
      expect(resolveGeneratedFrame({ cardType: "artifact", requested, colorIdentity: [], verifiedKeys: today, face: ship }), requested).toBe("m15artifact");
    }
    for (const roll of [0, 0.5, 0.99]) {
      expect(resolveGeneratedFrame({ cardType: "artifact", requested: "random", colorIdentity: [], verifiedKeys: today, face: ship, random: () => roll })).toBe("m15artifact");
    }
    // A Vehicle is untouched by the second dress.
    const car = { ...ship, subtypes: ["Vehicle"] };
    expect(resolveGeneratedFrame({ cardType: "artifact", requested: "m15artifact", colorIdentity: [], verifiedKeys: today, face: car })).toBe("m15vehicle");
    // Ticked: a new Spacecraft follows its subtype, as a new Vehicle does.
    const later = keys(["m15artifact", "c"], ["m15vehicle", "c"], ["m15station", "c"]);
    expect(resolveGeneratedFrame({ cardType: "artifact", requested: "m15vehicle", colorIdentity: [], verifiedKeys: later, face: ship })).toBe("m15station");
    expect(resolveGeneratedFrame({ cardType: "artifact", requested: "m15artifact", colorIdentity: [], verifiedKeys: later, face: ship })).toBe("m15station");
  });
});
