import { describe, expect, it } from "vitest";
import printingsData from "../cards/fixtures/reference-printings.json";
import { frameAnatomyOf } from "@/lib/cards/anatomy";
import { frameKindGateError, frameKindUpdateGateError } from "@/lib/cards/frame-kind-gate";
import { frameComboKey, FRAME_COLOR_KEYS } from "@/lib/cards/frame-reference-registry";
import { PLATE_INK } from "@/lib/cards/plate-ink";
import { frontDrawsPowerToughness } from "@/lib/cards/pt-drawn";
import { M15_CROWN, M15_HOLO_STAMP, getFrameProfile } from "@/lib/cards/template-layout";
import {
  framesForKind,
  isSubtypeDress,
  subtypeDressOf,
  subtypeDressReason,
  subtypeFrameFits,
  subtypeFrameFor,
  subtypesSay,
  templateRefusesKind,
  CARD_KIND_VALUES,
} from "@/lib/creator/card-kinds";
import { resolveGeneratedFrame } from "@/lib/creator/frame-random";
import { withVerification } from "@/lib/creator/frame-resolve";
import { frameFitsImport } from "@/lib/creator/import-frame-choice";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import { frameMatchFromScryfall } from "@/lib/scryfall/import-mapper";
import { validateReferenceForCombo } from "@/lib/cards/frame-reference-validation";
import { FRAME_TEMPLATE_VALUES, TEMPLATE_SKIN_VARIANTS } from "@/types/card";
import { CC_TEMPLATES, VEHICLE_PLATE_TONE, VEHICLE_PT_FILE, tonePlateRgba8 } from "@/scripts/lib/cc-frames.mjs";

// ---------------------------------------------------------------------------
// TODO 4.5c — the Vehicle frame (`m15vehicle`): a stored template of its own
// (owner 2026-09-29), for the cards whose subtype says Vehicle; new Vehicles
// start on it once it is verified, stored ones keep their frame, imports
// follow the printing. Sagas are not in it (owner 2026-10-12: the printed
// Final Fantasy body comes with 4.5d).
// ---------------------------------------------------------------------------

const printings = printingsData as Record<string, unknown>;
const keys = (...pairs: Array<[string, string]>) => new Set(pairs.map(([t, c]) => frameComboKey(t as never, c)));
const EVERY = new Set(FRAME_TEMPLATE_VALUES.flatMap((t) => FRAME_COLOR_KEYS.map((k) => frameComboKey(t, k))));
/** Captured printings (tests/unit/cards/fixtures/reference-printings.json). */
const COPTER = "kld-235";
const byName = (name: string) => {
  const found = Object.values(printings).find((p) => (p as { name: string }).name === name);
  if (!found) throw new Error(`no captured printing named ${name}`);
  return scryfallCardSchema.parse(found);
};

describe("the profile", () => {
  const vehicle = getFrameProfile("m15vehicle");
  const artifact = getFrameProfile("m15artifact");

  it("is the artifact frame's slots with its own brown plate and white digits", () => {
    const { pt: vehiclePt, label: vehicleLabel, ...restVehicle } = vehicle;
    const { pt: artifactPt, label: artifactLabel, ...restArtifact } = artifact;
    expect(restVehicle).toEqual(restArtifact);
    expect(vehicleLabel).toBe("M15 Vehicle");
    expect(artifactLabel).toBe("M15 Artifact");
    expect(vehiclePt).toEqual({ ...artifactPt, plateAssetPathTemplate: "/frames/m15vehicle/pt/{color}.png", colorHex: "#ffffff" });
    // M15's plate box (TODO 4.18): the prints' brown box reads x 1173–1420,
    // y 1868–1985 px at HD (52 prints), the plate's ink in this box 1158–1416.
    expect(vehiclePt?.plateRect).toEqual({ topPct: 88.48, leftPct: 75.73, widthPct: 18.8, heightPct: 7.33 });
  });

  it("draws the crown, the stamp notch, the collector line and the split pairs — a colourless Vehicle's crown and notch the artifact silver", () => {
    expect(vehicle.overlays).toEqual([
      { ...M15_CROWN, keyMap: { c: "a" } },
      { ...M15_HOLO_STAMP, keyMap: { c: "a" } },
    ]);
    expect(frameAnatomyOf("m15vehicle")).toEqual(frameAnatomyOf("m15artifact"));
    expect(vehicle.twoColorMasters).toEqual(["split"]);
  });

  it("has a measured keep-out for its plate, and the frame draws a P/T", () => {
    expect(PLATE_INK["/frames/m15vehicle/pt/{color}.png"]).toBeDefined();
    expect(frontDrawsPowerToughness("m15vehicle")).toBe(true);
    // Sagas are untouched (owner 2026-10-12): the saga body still draws none.
    expect(frontDrawsPowerToughness("saga")).toBe(false);
    expect(getFrameProfile("saga").pt).toBeUndefined();
  });
});

describe("the subtype dress", () => {
  it("names the Vehicle frame alone, a variation of the artifact frame", () => {
    expect(FRAME_TEMPLATE_VALUES.filter(isSubtypeDress)).toEqual(["m15vehicle"]);
    expect(subtypeDressOf("m15vehicle")).toBe("Vehicle");
    expect(subtypeDressOf("m15artifact")).toBeNull();
    expect(TEMPLATE_SKIN_VARIANTS.m15artifact).toEqual(["m15borderlessartifact", "m15vehicle"]);
    expect(subtypeDressReason("m15vehicle")).toBe("The Vehicle frame is for Vehicles");
    expect(subtypeDressReason("m15")).toBeNull();
  });

  it("reads the subtype whatever its case, and never a Spacecraft", () => {
    expect(subtypesSay(["Vehicle"], "Vehicle")).toBe(true);
    expect(subtypesSay([" vehicle "], "Vehicle")).toBe(true);
    expect(subtypesSay(["Spacecraft"], "Vehicle")).toBe(false);
    expect(subtypesSay([], "Vehicle")).toBe(false);
    expect(subtypesSay(null, "Vehicle")).toBe(false);
    expect(subtypeFrameFits("m15vehicle", ["Vehicle"])).toBe(true);
    expect(subtypeFrameFits("m15vehicle", ["Equipment"])).toBe(false);
    expect(subtypeFrameFits("m15vehicle", ["Spacecraft"])).toBe(false);
    for (const t of FRAME_TEMPLATE_VALUES) if (t !== "m15vehicle") expect(subtypeFrameFits(t, []), t).toBe(true);
  });

  it("follows the subtype between the artifact frame and its dress, and moves no other frame", () => {
    expect(subtypeFrameFor("m15artifact", ["Vehicle"])).toBe("m15vehicle");
    expect(subtypeFrameFor("m15vehicle", ["Vehicle"])).toBe("m15vehicle");
    expect(subtypeFrameFor("m15vehicle", [])).toBe("m15artifact");
    expect(subtypeFrameFor("m15artifact", ["Equipment"])).toBe("m15artifact");
    for (const t of FRAME_TEMPLATE_VALUES) {
      if (t === "m15artifact" || t === "m15vehicle") continue;
      expect(subtypeFrameFor(t, ["Vehicle"]), t).toBe(t);
    }
  });

  it("dresses the Artifact kind only", () => {
    expect(CARD_KIND_VALUES.filter((kind) => !templateRefusesKind("m15vehicle", kind))).toEqual(["artifact"]);
    expect(framesForKind("artifact", EVERY).map((f) => f.template)).toContain("m15vehicle");
    expect(framesForKind("creature", EVERY).map((f) => f.template)).not.toContain("m15vehicle");
  });
});

describe("the server's gate", () => {
  const vehicle = { cardType: "artifact", subtypes: ["Vehicle"], title: "Skysail Runabout" };
  const ring = { cardType: "artifact", subtypes: [], title: "Sol Ring" };

  it("takes a Vehicle on the Vehicle frame and refuses anything else there", () => {
    expect(frameKindGateError("m15vehicle", vehicle)).toBeNull();
    expect(frameKindGateError("m15vehicle", ring)).toBe("The Vehicle frame is for Vehicles — pick another frame.");
    expect(frameKindGateError("m15vehicle", { ...ring, subtypes: ["Spacecraft"] })).toBe(
      "The Vehicle frame is for Vehicles — pick another frame.",
    );
    expect(frameKindGateError("m15vehicle", { cardType: "creature", subtypes: ["Vehicle"], title: "x" })).toMatch(/doesn't dress Creature cards/);
    // Every other frame is as it was: a Vehicle may still wear any of them.
    expect(frameKindGateError("m15artifact", vehicle)).toBeNull();
    expect(frameKindGateError("m15", vehicle)).toBeNull();
    expect(frameKindGateError("modern", vehicle)).toBeNull();
  });

  it("refuses an edit that takes the Vehicle word off a card on the frame, or moves a non-Vehicle onto it", () => {
    expect(
      frameKindUpdateGateError({ existingTemplate: "m15vehicle", nextTemplate: undefined, existing: vehicle, next: ring }),
    ).toBe("The Vehicle frame is for Vehicles — pick another frame.");
    expect(
      frameKindUpdateGateError({ existingTemplate: "m15artifact", nextTemplate: "m15vehicle", existing: ring, next: ring }),
    ).toBe("The Vehicle frame is for Vehicles — pick another frame.");
    expect(
      frameKindUpdateGateError({ existingTemplate: "m15artifact", nextTemplate: "m15vehicle", existing: vehicle, next: vehicle }),
    ).toBeNull();
    // A stored Vehicle on another frame is never touched by the gate.
    expect(
      frameKindUpdateGateError({ existingTemplate: "m15", nextTemplate: undefined, existing: vehicle, next: vehicle }),
    ).toBeNull();
  });
});

describe("AI and random frames (resolveGeneratedFrame)", () => {
  const face = { cardType: "artifact", subtypes: ["Vehicle"], title: "Skysail Runabout", power: "3", toughness: "3" };

  it("lands a new Vehicle on the Vehicle frame where it is published in the card's colour, on the artifact frame where it isn't", () => {
    const both = keys(["m15artifact", "c"], ["m15vehicle", "c"]);
    expect(resolveGeneratedFrame({ cardType: "artifact", requested: "m15artifact", colorIdentity: [], verifiedKeys: both, face })).toBe("m15vehicle");
    for (const roll of [0, 0.3, 0.6, 0.99]) {
      expect(
        resolveGeneratedFrame({ cardType: "artifact", requested: "random", colorIdentity: [], verifiedKeys: both, face, random: () => roll }),
      ).toBe("m15vehicle");
    }
    const artifactOnly = keys(["m15artifact", "c"]);
    expect(resolveGeneratedFrame({ cardType: "artifact", requested: "m15artifact", colorIdentity: [], verifiedKeys: artifactOnly, face })).toBe("m15artifact");
    expect(resolveGeneratedFrame({ cardType: "artifact", requested: "random", colorIdentity: [], verifiedKeys: artifactOnly, face })).toBe("m15artifact");
  });

  it("never dresses another artifact as a Vehicle, asked for or at random", () => {
    const both = keys(["m15artifact", "c"], ["m15vehicle", "c"]);
    const ring = { cardType: "artifact", subtypes: [], title: "Sol Ring" };
    expect(resolveGeneratedFrame({ cardType: "artifact", requested: "m15vehicle", colorIdentity: [], verifiedKeys: both, face: ring })).toBe("m15artifact");
    for (const roll of [0, 0.5, 0.99]) {
      expect(
        resolveGeneratedFrame({ cardType: "artifact", requested: "random", colorIdentity: [], verifiedKeys: both, face: ring, random: () => roll }),
      ).toBe("m15artifact");
    }
    // …nor without a face at all.
    expect(resolveGeneratedFrame({ cardType: "artifact", requested: "random", colorIdentity: [], verifiedKeys: both })).toBe("m15artifact");
  });
});

describe("imports follow the printing (the registry's vehicle/2015 rule)", () => {
  const copter = scryfallCardSchema.parse(
    Object.values(printings).find((p) => `${(p as { set: string }).set}-${(p as { collector_number: string }).collector_number}` === COPTER),
  );

  it("a plain Vehicle printing lands on the artifact frame until the Vehicle frame is verified in its colour, then on it, exact", () => {
    const match = frameMatchFromScryfall(copter);
    expect(match).toMatchObject({
      signature: "vehicle/2015",
      status: "nearest",
      template: "m15artifact",
      reason: "PipGlyph's Vehicle frame isn't verified yet",
      blockedBy: "4.5c",
      onceVerified: "m15vehicle",
      onceVerifiedMatch: { status: "exact", reason: null },
    });
    expect(withVerification(match, "c", keys(["m15artifact", "c"]))).toMatchObject({ status: "nearest", template: "m15artifact" });
    expect(withVerification(match, "c", keys(["m15artifact", "c"], ["m15vehicle", "c"]))).toMatchObject({
      status: "exact",
      template: "m15vehicle",
    });
  });

  it("a two-colour Vehicle is exact too (the split pair masters); a coloured one in its colour", () => {
    const prototype = frameMatchFromScryfall(byName("Prodigy's Prototype"));
    expect(prototype).toMatchObject({ onceVerified: "m15vehicle", onceVerifiedMatch: { status: "exact" } });
    const suit = frameMatchFromScryfall(byName("Dragonfly Suit"));
    expect(suit).toMatchObject({ signature: "vehicle/2015", onceVerified: "m15vehicle", onceVerifiedMatch: { status: "exact" } });
    expect(withVerification(suit, "w", keys(["m15vehicle", "c"]))).toMatchObject({ status: "nearest", template: "m15artifact" });
  });

  it("a non-Vehicle artifact never takes the rule", () => {
    const strix = frameMatchFromScryfall(byName("Baleful Strix"));
    expect(strix.signature.startsWith("vehicle/")).toBe(false);
    expect(strix.onceVerified).toBeUndefined();
  });

  it("the import chooser offers the frame to a Vehicle only", () => {
    const patch = { card_type: "artifact" as const, supertype: "", subtypes_text: "Vehicle", title: "x", rules_text: "" };
    const input = { kind: "artifact" as const, colorKey: "c", verifiedKeys: EVERY };
    expect(frameFitsImport("m15vehicle", { ...input, patch })).toBe(true);
    expect(frameFitsImport("m15vehicle", { ...input, patch: { ...patch, subtypes_text: "Equipment" } })).toBe(false);
  });

  it("a reference printing must be a Vehicle", () => {
    expect(validateReferenceForCombo(copter, "m15vehicle", "c").errors).toEqual([]);
    const errors = validateReferenceForCombo(byName("Solemn Simulacrum"), "m15vehicle", "c").errors.join(" ");
    expect(errors).toMatch(/Vehicle/);
  });
});

describe("the importer's recipe", () => {
  type Layer = { src: string; mask?: string; right?: string };
  const def = (CC_TEMPLATES as Record<string, { colors: Record<string, Layer[]>; plates: Record<string, string>; plateTone: unknown }>).m15vehicle;
  const NEW = "img/frames/m15/new";

  it("is Card Conjurer's Vehicle recipe: the bronze frame through the Border and Frame masks, the colour's interior on top", () => {
    for (const key of ["w", "u", "b", "r", "g", "c", "m"]) {
      const interior = `${NEW}/${key === "c" ? "a" : key}.png`;
      expect(def.colors[key], key).toEqual([
        { src: `${NEW}/v.png`, mask: `${NEW}/border.png` },
        { src: `${NEW}/v.png`, mask: `${NEW}/frame.png` },
        { src: interior, mask: `${NEW}/rules.png` },
        { src: interior, mask: `${NEW}/title.png` },
        { src: interior, mask: `${NEW}/type.png` },
        { src: interior, mask: `${NEW}/pinline.png` },
      ]);
    }
  });

  it("builds the ten split pairs over the bronze frame — never the artifact frame, never a hybrid dress", () => {
    const pairs = Object.keys(def.colors).filter((k) => k.length === 2);
    expect(pairs).toEqual(["wu", "wb", "ub", "ur", "br", "bg", "rg", "rw", "gw", "gu"]);
    expect(Object.keys(def.colors).filter((k) => k.endsWith("-h"))).toEqual([]);
    for (const pair of pairs) {
      const [border, frame, rules, title, type, pinline] = def.colors[pair];
      expect(border, pair).toEqual({ src: `${NEW}/v.png`, mask: `${NEW}/border.png` });
      expect(frame, pair).toEqual({ src: `${NEW}/v.png`, mask: `${NEW}/frame.png` });
      expect(title.src).toBe(`${NEW}/m.png`);
      expect(type.src).toBe(`${NEW}/m.png`);
      expect(rules.src).toBe(`${NEW}/${pair[0]}.png`);
      expect(rules.right).toBe(`${NEW}/${pair[1]}.png`);
      expect(pinline.right).toBe(`${NEW}/${pair[1]}.png`);
      for (const layer of def.colors[pair]) expect(layer.src, pair).not.toBe(`${NEW}/a.png`);
    }
  });

  it("writes ONE plate under every colour key, toned onto the prints with its hue kept", () => {
    expect(new Set(Object.values(def.plates))).toEqual(new Set([VEHICLE_PT_FILE]));
    expect(Object.keys(def.plates).sort()).toEqual(["b", "c", "g", "m", "r", "u", "w"]);
    expect(def.plateTone).toBe(VEHICLE_PLATE_TONE);
    // Card Conjurer's face, a bevel highlight, a neutral grey, black, and a
    // half-transparent pixel: alpha is never touched.
    const px = Buffer.from([110, 73, 30, 255, 200, 160, 110, 255, 100, 100, 100, 255, 0, 0, 0, 255, 110, 73, 30, 128]);
    tonePlateRgba8(px, VEHICLE_PLATE_TONE);
    const face = [px[0], px[1], px[2]];
    // The prints' median is 123 / 91 / 67 (52 plain Vehicles).
    for (const [i, want] of [123, 91, 67].entries()) expect(Math.abs(face[i] - want), `channel ${i}`).toBeLessThanOrEqual(6);
    // Hue kept: still r > g > b everywhere, and the highlight is no bluer than it is red.
    expect(px[4]).toBeGreaterThan(px[5]);
    expect(px[5]).toBeGreaterThan(px[6]);
    expect([px[8], px[9], px[10]]).toEqual([124, 124, 124]);
    expect([px[12], px[13], px[14]]).toEqual([0, 0, 0]);
    expect([px[3], px[7], px[11], px[15], px[19]]).toEqual([255, 255, 255, 255, 128]);
  });
});
