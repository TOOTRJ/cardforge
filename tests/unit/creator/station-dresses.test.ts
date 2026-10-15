import { describe, expect, it } from "vitest";
import { frameKindGateError } from "@/lib/cards/frame-kind-gate";
import { FRAME_COLOR_KEYS, frameComboKey } from "@/lib/cards/frame-reference-registry";
import { getFrameProfile } from "@/lib/cards/template-layout";
import {
  CARD_KIND_VALUES,
  framesForKind,
  isPickOnlyDress,
  isSubtypeDress,
  skinVariantsFor,
  subtypeDressOf,
  subtypeFrameFits,
  subtypeFrameFor,
  templateRefusesKind,
} from "@/lib/creator/card-kinds";
import { resolveDeckCardFrame, resolveGeneratedFrame } from "@/lib/creator/frame-random";
import { FRAME_TEMPLATE_VALUES, type FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.27a step 2 — the Spacecraft's extended-art and borderless DRESSES
// (`extendedartstation`, `m15borderlessstation`; owner 2026-10-13 Q4: built in
// PR 4). The gate is the station frame's (SUBTYPE_DRESSES: an artifact whose
// subtypes say Spacecraft, nothing else); unlike it, they are a PICK:
//   • a new Spacecraft follows its subtype onto the BORDERED station frame
//     only — never onto a dress, and a card on extended art or the
//     borderless artifact frame stays there;
//   • a card on a dress keeps it while its subtypes say Spacecraft, and goes
//     back to the frame the dress re-dresses when they stop;
//   • the AI never picks one unasked (the random pool, a deck); asked for by
//     name, a Spacecraft with a tier gets it.
// ---------------------------------------------------------------------------

const DRESSES = ["extendedartstation", "m15borderlessstation"] as const satisfies readonly FrameTemplate[];
const BASE: Record<(typeof DRESSES)[number], FrameTemplate> = { extendedartstation: "extendedart", m15borderlessstation: "m15borderlessartifact" };
const EVERY: ReadonlySet<string> = new Set(FRAME_TEMPLATE_VALUES.flatMap((t) => FRAME_COLOR_KEYS.map((k) => frameComboKey(t, k))));
const ship = {
  cardType: "artifact",
  subtypes: ["Spacecraft"],
  title: "Lumen-Class Frigate",
  rulesText: "Station\n2+ | Other creatures you control get +1/+1.\n12+ | Flying, lifelink",
  power: "3",
  toughness: "5",
};

describe("the gate: a Spacecraft only", () => {
  it.each(DRESSES)("%s dresses an artifact whose subtypes say Spacecraft — nothing else", (t) => {
    expect(subtypeDressOf(t)).toBe("Spacecraft");
    expect(isSubtypeDress(t)).toBe(true);
    expect(isPickOnlyDress(t)).toBe(true);
    expect(CARD_KIND_VALUES.filter((kind) => !templateRefusesKind(t, kind))).toEqual(["artifact"]);
    expect(subtypeFrameFits(t, ["Spacecraft"])).toBe(true);
    expect(subtypeFrameFits(t, ["Vehicle"])).toBe(false);
    expect(subtypeFrameFits(t, ["Planet"])).toBe(false);
    expect(subtypeFrameFits(t, [])).toBe(false);
    expect(frameKindGateError(t, { cardType: "artifact", subtypes: ["Spacecraft"] } as never)).toBeNull();
    expect(frameKindGateError(t, { cardType: "artifact", subtypes: ["Equipment"] } as never)).toMatch(/Spacecraft/);
    expect(frameKindGateError(t, { cardType: "land", subtypes: ["Planet"] } as never)).not.toBeNull();
    // The station frame's tiers; no corner P/T slot.
    expect(getFrameProfile(t).tiers).toEqual(getFrameProfile("m15station").tiers);
    expect(getFrameProfile(t).pt).toBeUndefined();
  });

  it("the bordered pair stays the only dresses a card FOLLOWS onto", () => {
    expect(FRAME_TEMPLATE_VALUES.filter(isPickOnlyDress)).toEqual(["m15borderlessstation", "extendedartstation"]);
    expect(isPickOnlyDress("m15station")).toBe(false);
    expect(isPickOnlyDress("m15vehicle")).toBe(false);
  });
});

describe("the creator: offered under Variations where verified, never followed onto", () => {
  it("an artifact's Variations list them, after the station frame", () => {
    const skins = skinVariantsFor("artifact", "m15artifact");
    expect(skins.indexOf("m15borderlessstation")).toBeGreaterThan(skins.indexOf("m15station"));
    expect(skins).toContain("extendedartstation");
    // …and only an artifact's.
    for (const kind of CARD_KIND_VALUES.filter((k) => k !== "artifact")) {
      for (const t of DRESSES) expect(framesForKind(kind, EVERY).some((c) => c.template === t), `${kind} ${t}`).toBe(false);
    }
  });

  it("unverified, an artifact's gallery offers them in no colour; verified in one, in that one", () => {
    const none = framesForKind("artifact", new Set<string>());
    for (const t of DRESSES) expect(none.find((c) => c.template === t)?.availableColorKeys ?? [], t).toEqual([]);
    const white = framesForKind("artifact", new Set([frameComboKey("extendedartstation", "w")]));
    expect(white.find((c) => c.template === "extendedartstation")?.availableColorKeys).toEqual(["w"]);
  });

  it.each(DRESSES)("%s: kept while worn, back to its own base when the subtypes stop saying Spacecraft", (t) => {
    expect(subtypeFrameFor(t, ["Spacecraft"])).toBe(t);
    expect(subtypeFrameFor(t, ["Spacecraft"], () => true)).toBe(t);
    expect(subtypeFrameFor(t, [])).toBe(BASE[t]);
    expect(subtypeFrameFor(t, ["Vehicle"])).toBe(BASE[t]);
  });

  it("a new Spacecraft follows its subtype onto the BORDERED station frame only", () => {
    const all = () => true;
    expect(subtypeFrameFor("m15artifact", ["Spacecraft"], all)).toBe("m15station");
    expect(subtypeFrameFor("extendedart", ["Spacecraft"], all)).toBe("extendedart");
    expect(subtypeFrameFor("m15borderlessartifact", ["Spacecraft"], all)).toBe("m15borderlessartifact");
  });
});

describe("the AI never picks them unasked", () => {
  it("a random pool over every verified frame never draws a dress", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const roll = i / 400;
      const got = resolveGeneratedFrame({ cardType: "artifact", requested: "random", colorIdentity: ["white"], verifiedKeys: EVERY, face: ship, random: () => roll });
      if (got) seen.add(got);
    }
    for (const t of DRESSES) expect(seen.has(t), t).toBe(false);
    expect(seen.has("m15station")).toBe(true);
  });

  it("a deck's Spacecraft takes the bordered station frame where it is verified, never a dress", () => {
    expect(resolveDeckCardFrame({ cardType: "artifact", colorIdentity: ["white"], verifiedKeys: EVERY, face: ship })).toBe("m15station");
  });

  it.each(DRESSES)("asked for %s by name, a Spacecraft with a tier gets it; one with no tier falls back to its base; a non-Spacecraft never", (t) => {
    expect(resolveGeneratedFrame({ cardType: "artifact", requested: t, colorIdentity: ["white"], verifiedKeys: EVERY, face: ship })).toBe(t);
    const noTier = { ...ship, rulesText: "Flying" };
    expect(resolveGeneratedFrame({ cardType: "artifact", requested: t, colorIdentity: ["white"], verifiedKeys: EVERY, face: noTier, fallback: "none" })).not.toBe(t);
    const sol = { ...ship, subtypes: [] as string[], rulesText: "{T}: Add {C}{C}." };
    expect(resolveGeneratedFrame({ cardType: "artifact", requested: t, colorIdentity: [], verifiedKeys: EVERY, face: sol, fallback: "none" })).not.toBe(t);
  });
});
