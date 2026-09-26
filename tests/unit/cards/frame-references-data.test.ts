import { describe, expect, it } from "vitest";
import { z } from "zod";
import referencesData from "@/lib/cards/frame-references.json";
import {
  FRAME_COLOR_KEYS,
  FRAME_REFERENCES,
  findFrameReference,
  frameReferenceNote,
  frameReferenceOptions,
  referenceTierLabel,
} from "@/lib/cards/frame-reference-registry";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// lib/cards/frame-references.json is the compare tool's ground truth: every
// template × colour lists the printings it is verified against, default
// first. A typo here silently points a verification at the wrong card, so
// the shape, the ids and the coverage are pinned.
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const referenceSchema = z
  .object({
    name: z.string().min(1),
    set: z.string().min(2).max(6),
    scryfallId: z.string().regex(UUID),
    tier: z.union([z.literal(1), z.literal(2)]).optional(),
    /** Hand-researched against a highres scan (2026-07-01) rather than found by the script. */
    curated: z.literal(true).optional(),
  })
  .strict();

const templateSchema = z
  .object({
    note: z.string().min(1).optional(),
    confirm: z.literal(true).optional(),
    colors: z.object(
      Object.fromEntries(
        FRAME_COLOR_KEYS.map((key) => [key, z.array(referenceSchema).min(1).nullable()]),
      ),
    ).strict(),
  })
  .strict();

// Combos with no real printing — a null here is documented, anything else
// null is a hole in the research.
const DOCUMENTED_NULLS = new Set([
  "m15tokenartifact/g",
  "adventure/c",
  "split/w", "split/u", "split/b", "split/r", "split/g", "split/c",
  "aftermath/c",
  "flip/c", "flip/m",
  "alphatoken/w", "alphatoken/u", "alphatoken/b", "alphatoken/r", "alphatoken/g", "alphatoken/c", "alphatoken/m",
  "fullart/c",
  // Full-art basics (4.39): no multicolour basic, and the one left-disc
  // Wastes (FIN #309) is black-bordered — no borderless one (owner visual
  // sign-off instead).
  "m15fullartland/m",
  "fullartland/c", "fullartland/m",
  "m15textless/u",
  "m15textlessland/c", "m15textlessland/m",
  "expeditionland/w", "expeditionland/u", "expeditionland/b", "expeditionland/r", "expeditionland/g",
  "nyx/c",
  "lotr/c",
  "bloomburrow/c",
  "tarkirdragon/u", "tarkirdragon/b", "tarkirdragon/r", "tarkirdragon/g", "tarkirdragon/c",
  "tarkirghostfire/u", "tarkirghostfire/b",
]);

describe("frame-references.json", () => {
  const data = referencesData as Record<string, unknown>;

  it("has exactly one entry per frame template and nothing else", () => {
    expect(Object.keys(data).sort()).toEqual([...FRAME_TEMPLATE_VALUES].sort());
  });

  for (const template of FRAME_TEMPLATE_VALUES) {
    it(`${template}: well-formed, unique ids, documented nulls`, () => {
      const parsed = templateSchema.safeParse(data[template]);
      expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
      if (!parsed.success) return;
      for (const key of FRAME_COLOR_KEYS) {
        const list = parsed.data.colors[key];
        const combo = `${template}/${key}`;
        if (list === null) {
          expect(DOCUMENTED_NULLS.has(combo), `${combo} is null but not documented`).toBe(true);
          continue;
        }
        expect(DOCUMENTED_NULLS.has(combo), `${combo} is documented null but has references`).toBe(false);
        const ids = list.map((ref) => ref.scryfallId);
        expect(new Set(ids).size).toBe(ids.length);
      }
    });
  }

  it("keeps the hand-researched M15 defaults first", () => {
    expect(FRAME_REFERENCES.m15.w?.name).toBe("Serra Angel");
    expect(FRAME_REFERENCES.m15.c?.name).toBe("Ulamog, the Ceaseless Hunger");
    expect(FRAME_REFERENCES.saga.m?.name).toBe("The Kami War // O-Kagachi Made Manifest");
    expect(FRAME_REFERENCES.battle.w?.name).toMatch(/^Invasion of Gobakhan/);
  });

  it("gives most combos an alternate printing", () => {
    let withAlternates = 0;
    let total = 0;
    for (const template of FRAME_TEMPLATE_VALUES) {
      for (const key of FRAME_COLOR_KEYS) {
        const options = frameReferenceOptions(template, key);
        if (options.length === 0) continue;
        total += 1;
        if (options.length > 1) withAlternates += 1;
        expect(FRAME_REFERENCES[template][key]).toEqual(options[0]);
      }
    }
    expect(total).toBeGreaterThan(200);
    expect(withAlternates / total).toBeGreaterThan(0.8);
  });
});

describe("registry helpers", () => {
  it("findFrameReference only accepts ids the combo lists", () => {
    const [first] = frameReferenceOptions("m15", "w");
    expect(findFrameReference("m15", "w", first.scryfallId)).toEqual(first);
    expect(findFrameReference("m15", "u", first.scryfallId)).toBeNull();
    expect(findFrameReference("m15", "w", "not-an-id")).toBeNull();
    expect(findFrameReference("m15", "w", null)).toBeNull();
  });

  it("flags the families a human must confirm and explains the scan tiers", () => {
    expect(frameReferenceNote("bloomburrow").confirm).toBe(true);
    expect(frameReferenceNote("m15").confirm).toBe(false);
    expect(frameReferenceNote("split").note).toMatch(/never printed/);
    expect(referenceTierLabel({ name: "x", set: "y", scryfallId: "z" })).toBeNull();
    expect(referenceTierLabel({ name: "x", set: "y", scryfallId: "z", tier: 1 })).toMatch(/low-resolution/);
    expect(referenceTierLabel({ name: "x", set: "y", scryfallId: "z", tier: 2 })).toMatch(/foil/);
  });
});

// Frames plan 4.32 / 4.39: the references the items list, two per colour
// (short text first), looked up on Scryfall by set + collector number.
describe("4.32 / 4.39 references", () => {
  const ids = (template: string, key: string) =>
    frameReferenceOptions(template, key).map((r) => `${r.set} ${r.name}`);

  it("m15borderless: the borderless printings of TODO 4.32, per colour (print review 2026-09-26)", () => {
    expect(ids("m15borderless", "w")).toEqual(["inr Thraben Inspector", "hob The Eagles Are Coming!"]);
    expect(ids("m15borderless", "u")).toEqual(["mh3 Flare of Denial", "fdn An Offer You Can't Refuse"]);
    expect(ids("m15borderless", "b")).toEqual(["fdn Vengeful Bloodwitch", "m21 Grim Tutor"]);
    // CMM #697 (another treatment), SOS #294 (a Lesson emblem), IKO #377
    // (Godzilla layout), MH3 #328 (a blue devoid card), FRA #461 / TLA #306
    // (two-colour pinlines) can't be scored against: replaced by prints that
    // measured within ±1 px.
    expect(ids("m15borderless", "r")).toEqual(["fra Essence Burn", "fra Stingcaster Mage"]);
    expect(ids("m15borderless", "g")).toEqual(["fra Tarmogoyf", "msh Earth's Mightiest Heroes"]);
    expect(ids("m15borderless", "c")).toEqual(["fdn Sire of Seven Deaths", "hob Troop of Ponies"]);
    // m: three-colour prints, the uniform gold pinline the master draws.
    expect(ids("m15borderless", "m")).toEqual(["sld Titanic Ultimatum", "sld Ruinous Ultimatum"]);
    for (const key of FRAME_COLOR_KEYS) {
      for (const ref of frameReferenceOptions("m15borderless", key)) {
        expect(["iko", "cmm", "sos"].includes(ref.set) || ref.name === "Ugin's Binding", ref.name).toBe(false);
      }
    }
    // 1.17's fixtures FDN #311 and M21 #315 are registered.
    expect(findFrameReference("m15borderless", "u", "6f6aaee9-8c44-4e23-8167-ead64e599711")?.name).toBe(
      "An Offer You Can't Refuse",
    );
    expect(findFrameReference("m15borderless", "b", "fbf0dded-552a-4ad2-bb62-f1bfabad9bac")?.name).toBe("Grim Tutor");
    // FRA #447 is a foil-only promo.
    expect(frameReferenceOptions("m15borderless", "r")[1].tier).toBe(2);
    expect(frameReferenceNote("m15borderless").note).toMatch(/arch/i);
  });

  it("m15borderlessartifact: CC's artifact frame for colourless (TODO 4.32's A pair)", () => {
    expect(ids("m15borderlessartifact", "c")).toEqual(["cmm Jeweled Lotus", "mh2 Sword of Hearth and Home"]);
    expect(frameReferenceNote("m15borderlessartifact").confirm).toBe(true);
    // Its m references print a two-colour pinline: m waits for 4.6.
    expect(frameReferenceNote("m15borderlessartifact").note).toMatch(/leave m unverified/);
  });

  it("m15fullartland: the 2024–25 printings (ONE / MOM are an older bar geometry); fullartland: FRA #382–396 only", () => {
    const second = { w: "tdm", u: "dsk", b: "dft", r: "tdm", g: "dsk" } as const;
    for (const [key, name] of [["w", "Plains"], ["u", "Island"], ["b", "Swamp"], ["r", "Mountain"], ["g", "Forest"]] as const) {
      expect(ids("m15fullartland", key)).toEqual([`fdn ${name}`, `${second[key]} ${name}`]);
      expect(ids("fullartland", key)).toEqual([`fra ${name}`, `fra ${name}`]);
    }
    for (const key of FRAME_COLOR_KEYS) {
      for (const ref of frameReferenceOptions("m15fullartland", key)) expect(["one", "mom"]).not.toContain(ref.set);
    }
    expect(frameReferenceNote("m15fullartland").note).toMatch(/ONE #262–266 and MOM #282–290/);
    // FIN #309, the one printed left-disc Wastes.
    expect(ids("m15fullartland", "c")).toEqual(["fin Wastes"]);
    expect(FRAME_REFERENCES.m15fullartland.c?.scryfallId).toBe("c61feafd-ef09-437c-a12c-fd7d6cb8c15a");
    // UNF / EOE textless basics and the old HOB / BFZ picks are gone.
    for (const key of FRAME_COLOR_KEYS) {
      for (const ref of frameReferenceOptions("fullartland", key)) expect(ref.set).toBe("fra");
    }
    expect(FRAME_REFERENCES.fullartland.c).toBeNull();
    expect(FRAME_REFERENCES.m15fullartland.m).toBeNull();
    expect(frameReferenceNote("fullartland").note).toMatch(/nearest/);
  });
})
