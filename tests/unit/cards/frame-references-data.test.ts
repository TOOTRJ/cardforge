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
    /** The BACK face of a double-faced printing (TODO 5.1a): a back body's reference. */
    face: z.literal(1).optional(),
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
  // The 2014–19 arch tokens (TODO 4.49's re-pin): no textless three-colour
  // arch token, and no white / black / red / green / gold arch artifact token
  // (the M20+ full-art prints are 4.48 / 4.50's).
  "m15token/m",
  "m15tokenartifact/w", "m15tokenartifact/b", "m15tokenartifact/r", "m15tokenartifact/g", "m15tokenartifact/m",
  // …and no white / black / red / green / gold text-box arch artifact token
  // either (4.49 (b)).
  "m15tokenartifacttext/w", "m15tokenartifacttext/b", "m15tokenartifacttext/r", "m15tokenartifacttext/g",
  "m15tokenartifacttext/m",
  // The emblem (TODO 4.52): colourless by rule (CR 114) — every printed one
  // is on the one silver frame, so only `c` has printings.
  "emblem/w", "emblem/u", "emblem/b", "emblem/r", "emblem/g", "emblem/m",
  // The full-art tokens (4.48 / 4.50; heights measured on the prints,
  // Scryfall 2026-09-29): no red, colourless or three-colour tall token
  // outside a legend; no black (T40K #14 prints its own layout), green or
  // three-colour textless artifact token; no green or non-legendary gold
  // text-box one; tall artifact tokens are colourless (Map, MKM's Clues).
  "m20tokentall/r",
  "m20tokentall/c",
  "m20tokentall/m",
  "m20tokenartifact/b",
  "m20tokenartifact/g",
  "m20tokenartifact/m",
  "m20tokenartifacttext/g",
  "m20tokenartifacttext/m",
  "m20tokenartifacttall/w",
  "m20tokenartifacttall/u",
  "m20tokenartifacttall/b",
  "m20tokenartifacttall/r",
  "m20tokenartifacttall/g",
  "m20tokenartifacttall/m",
  "adventure/c",
  "split/w", "split/u", "split/b", "split/r", "split/g", "split/c",
  "aftermath/c",
  // No gold // gold aftermath exists (every two-colour one is mono // mono,
  // TODO 4.26's per-part colour): the HOU stand-ins were dropped so a
  // template Publish can't tick the combo (4.21a follow-up, 2026-10-02).
  "aftermath/m",
  "flip/c", "flip/m",
  "alphatoken/w", "alphatoken/u", "alphatoken/b", "alphatoken/r", "alphatoken/g", "alphatoken/c", "alphatoken/m",
  "fullart/c",
  // Full-art basics (4.39): no multicolour basic, and the one left-disc
  // Wastes (FIN #309) is black-bordered — no borderless one (owner visual
  // sign-off instead).
  "m15fullartland/m",
  "fullartland/c", "fullartland/m",
  // No colourless borderless textless printing exists (TODO 1.4: the Aang
  // reference was multicolour).
  "m15textless/u", "m15textless/c",
  "m15textlessland/c", "m15textlessland/m",
  // The anime frame is the raised-foil legends BLB #343–355: one mono-green
  // card and multicolour legends (TODO 1.4, checked by eye 2026-09-28).
  "bloomanime/w", "bloomanime/u", "bloomanime/b", "bloomanime/r", "bloomanime/c",
  "expeditionland/w", "expeditionland/u", "expeditionland/b", "expeditionland/r", "expeditionland/g",
  "nyx/c",
  "lotr/c",
  "bloomburrow/c",
  "tarkirdragon/u", "tarkirdragon/b", "tarkirdragon/r", "tarkirdragon/g", "tarkirdragon/c",
  "tarkirghostfire/u", "tarkirghostfire/b",
  // The transform land pair (TODO 5.1a): one master under every key, the
  // emblem's model — verified on c only (INR #287 / FIN #31).
  "m15dfclandfront/w", "m15dfclandfront/u", "m15dfclandfront/b", "m15dfclandfront/r", "m15dfclandfront/g", "m15dfclandfront/m",
  "m15dfclandback/w", "m15dfclandback/u", "m15dfclandback/b", "m15dfclandback/r", "m15dfclandback/g", "m15dfclandback/m",
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

  it("defaults m15snow w/b/g to the snow printings production verified them against (1.4 A6)", () => {
    // frame_reviews.verified_reference_id on production, 2026-09-29.
    expect(FRAME_REFERENCES.m15snow.w).toMatchObject({
      name: "Search for Glory",
      scryfallId: "b65c215d-562d-4c7c-bc9f-b1d741050158",
      curated: true,
    });
    expect(FRAME_REFERENCES.m15snow.b).toMatchObject({
      name: "Priest of the Haunted Edge",
      scryfallId: "0cde0f4d-5acc-4a25-a3d6-c6b9b734360c",
      curated: true,
    });
    expect(FRAME_REFERENCES.m15snow.g).toMatchObject({
      name: "Sculptor of Winter",
      scryfallId: "9dab2ca2-0039-4eac-a7dc-68756362737d",
      curated: true,
    });
    // The plain-frame printings that stood in for them are gone.
    const names = ["w", "b", "g"].flatMap((key) => frameReferenceOptions("m15snow", key).map((r) => r.name));
    for (const name of ["Axgard Braggart", "Deathknell Berserker", "Sarulf's Packmate"]) {
      expect(names).not.toContain(name);
    }
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
describe("4.32 / 4.34 / 4.39 references", () => {
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
    // Its m references print a two-colour pinline, which the two-colour
    // switch draws since 4.6f (wave 2a).
    expect(frameReferenceNote("m15borderlessartifact").note).toMatch(/since 4\.6f/);
  });

  it("m15borderlessland: non-legendary prints whose type bar wears the title's tint, the best-registered first (TODO 4.34)", () => {
    // White verifies against Monumental Henge MH3 #354 alone (owner round
    // 16), like u and g: Ancient Den SLD #300 is no longer a reference.
    expect(ids("m15borderlessland", "w")).toEqual(["mh3 Monumental Henge"]);
    // Not FRA #380 / #381: they print a DARK type bar over the tinted box
    // (4.34's second skeptic pass; BORDERLESS_LAND_DARK_TYPE_BAR_PINS). One
    // reference each for u and g (owner round 15): the only other exact
    // mono-u / mono-g prints (SLD #230 / #301 / #304) show the art through
    // their bars, and SLD #304 is a scaled scan.
    expect(ids("m15borderlessland", "u")).toEqual(["mh3 Archway of Innovation"]);
    expect(ids("m15borderlessland", "b")).toEqual(["mh3 Spymaster's Vault", "mh2 Cabal Coffers"]);
    expect(ids("m15borderlessland", "r")).toEqual(["slp Valakut, the Molten Pinnacle", "mh3 Arena of Glory"]);
    expect(ids("m15borderlessland", "g")).toEqual(["mh3 Shifting Woodland"]);
    // c = colourless lands; m = three and more colours (gold bars and box).
    expect(ids("m15borderlessland", "c")).toEqual(["cmm Reliquary Tower", "cmm Myriad Landscape"]);
    expect(ids("m15borderlessland", "m")).toEqual(["cmm Command Tower", "msh Avengers Tower"]);
    for (const key of FRAME_COLOR_KEYS) {
      for (const ref of frameReferenceOptions("m15borderlessland", key)) {
        // Never a set that prints the DARK type bar, never a two-colour print.
        expect(["woe", "acr", "tdm", "eoe", "fic"], ref.name).not.toContain(ref.set);
        expect(["Deserted Beach", "Spirebluff Canal"], ref.name).not.toContain(ref.name);
        // Never the see-through SLD prints the owner turned down (round 15),
        // nor Ancient Den SLD #300 (round 16).
        expect(["Shelldock Isle", "Seat of the Synod", "Tree of Tales", "Ancient Den"], ref.name).not.toContain(ref.name);
      }
    }
    expect(frameReferenceNote("m15borderlessland").confirm).toBe(true);
    expect(frameReferenceNote("m15borderlessland").note).toMatch(/SPLIT pinline/);
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

// TODO 4.49's re-pin (token research 2026-09-29): the 2014–19 arch token
// frames are referenced to the arch prints only — 16 of m15token's 20 and
// all 13 of m15tokenartifact's references were M20+ full-art prints, and
// m15token/c was an ARTIFACT (TXLN #7 Treasure). The M20+ prints are 4.48 /
// 4.50's; the text-box prints wait for 4.49 (b)'s m15tokentext /
// m15tokenartifacttext.
describe("4.49 token references", () => {
  const ids = (template: string, key: string) =>
    frameReferenceOptions(template, key).map((r) => `${r.set} ${r.name}`);

  it("m15token: two textless 2014–19 arch prints per colour, none for m", () => {
    expect(ids("m15token", "w")).toEqual(["tdom Soldier", "tm19 Soldier"]);
    expect(ids("m15token", "u")).toEqual(["tbfz Octopus", "twar Wizard"]);
    expect(ids("m15token", "b")).toEqual(["tm19 Zombie", "tdom Cleric"]);
    expect(ids("m15token", "r")).toEqual(["tdom Goblin", "tmh1 Elemental"]);
    expect(ids("m15token", "g")).toEqual(["tdom Saproling", "tm19 Beast"]);
    // The see-through grey frame over the art that m15token/c draws.
    expect(ids("m15token", "c")).toEqual(["tbfz Eldrazi", "temn Eldrazi Horror"]);
    expect(FRAME_REFERENCES.m15token.c?.scryfallId).toBe("30ff04d5-ecaf-4be2-94f4-d5409f1c1e4e");
    expect(FRAME_REFERENCES.m15token.m).toBeNull();
  });

  it("m15tokenartifact: c TKLD #2 · TMH1 #18, u TC18 #7, nothing else", () => {
    expect(ids("m15tokenartifact", "c")).toEqual(["tkld Construct", "tmh1 Golem"]);
    expect(ids("m15tokenartifact", "u")).toEqual(["tc18 Myr"]);
    for (const key of ["w", "b", "r", "g", "m"] as const) expect(FRAME_REFERENCES.m15tokenartifact[key]).toBeNull();
  });

  it("lists no M20+ print on either arch frame (released before M20, 2019-07-12)", () => {
    // Every arch token set: the 2014–19 token sets the pins come from.
    const ARCH = new Set(["tdom", "tm19", "tbfz", "twar", "tmh1", "temn", "tkld", "tc18"]);
    for (const template of ["m15token", "m15tokenartifact"]) {
      for (const key of FRAME_COLOR_KEYS) {
        for (const ref of frameReferenceOptions(template, key)) expect(ARCH.has(ref.set), `${template}/${key} ${ref.set}`).toBe(true);
      }
      expect(frameReferenceNote(template).note).toMatch(/2014–19 arch/);
    }
  });
});

// TODO 4.49 (b): the text-box arch tokens are referenced to the 2014–19
// text-box prints, two per colour (4.49's list); m15tokenartifacttext has
// c and u only. TSOI #11 Clue, on 4.49's list, prints the TALL box (type bar
// at ~56 %H, no CC source: 4.49's P3), so TXLN #10 Treasure — the re-cut's
// ruler print — stands in for it.
describe("4.49 (b) text-box token references", () => {
  const ids = (template: string, key: string) =>
    frameReferenceOptions(template, key).map((r) => `${r.set} ${r.name}`);

  it("m15tokentext: two text-box arch prints per colour", () => {
    expect(ids("m15tokentext", "w")).toEqual(["tdom Knight", "tm19 Angel"]);
    expect(ids("m15tokentext", "u")).toEqual(["tm15 Squid", "tc16 Bird"]);
    expect(ids("m15tokentext", "b")).toEqual(["tm19 Bat", "twar Assassin"]);
    expect(ids("m15tokentext", "r")).toEqual(["tm19 Dragon", "tsoi Devil"]);
    expect(ids("m15tokentext", "g")).toEqual(["tm15 Insect", "txln Dinosaur"]);
    expect(ids("m15tokentext", "m")).toEqual(["tc17 Cat Dragon", "twar Citizen"]);
    // The see-through grey frame and box over the art that m15tokentext/c draws.
    expect(ids("m15tokentext", "c")).toEqual(["tbfz Eldrazi Scion", "togw Eldrazi Scion"]);
    expect(FRAME_REFERENCES.m15tokentext.w?.scryfallId).toBe("cc7d137c-f6c0-44e5-af9f-a8bbd52d3b2a");
  });

  it("m15tokenartifacttext: c TXLN #7 · TM19 #14 · TXLN #10, u TC16 #9 · TC18 #8, nothing else", () => {
    expect(ids("m15tokenartifacttext", "c")).toEqual(["txln Treasure", "tm19 Thopter", "txln Treasure"]);
    expect(ids("m15tokenartifacttext", "u")).toEqual(["tc16 Thopter", "tc18 Thopter"]);
    for (const key of ["w", "b", "r", "g", "m"] as const) expect(FRAME_REFERENCES.m15tokenartifacttext[key]).toBeNull();
    // Not the tall-box Clue.
    expect(frameReferenceOptions("m15tokenartifacttext", "c").map((r) => r.scryfallId)).not.toContain(
      "f2c859e1-181e-44d1-afbd-bbd6e52cf42a",
    );
  });

  it("lists only 2014–19 arch prints (released before M20, 2019-07-12)", () => {
    const ARCH = new Set(["tdom", "tm19", "tm15", "tc16", "twar", "tsoi", "txln", "tc17", "tbfz", "togw", "tc18"]);
    for (const template of ["m15tokentext", "m15tokenartifacttext"]) {
      for (const key of FRAME_COLOR_KEYS) {
        for (const ref of frameReferenceOptions(template, key)) expect(ARCH.has(ref.set), `${template}/${key} ${ref.set}`).toBe(true);
      }
      expect(frameReferenceNote(template).note).toMatch(/2014–19 arch/);
    }
  });
});

// TODO 4.48 / 4.50: the full-art tokens are referenced to M20+ prints of
// their own height — measured on the Scryfall PNGs (the type pill at ~81,
// ~67 or ~56 %H), since Scryfall has no field for it — mono-colour, no
// legend (the crown and two-colour gradients are 4.6), m = three colours.
describe("4.48 / 4.50 full-art token references", () => {
  const ids = (template: string, key: string) =>
    frameReferenceOptions(template, key).map((r) => `${r.set} ${r.name}`);

  it("m20token: textless prints, TFDN first; the first-year TM20 #2 and T2XM #4 on white", () => {
    expect(ids("m20token", "w")).toEqual(["tfdn Soldier", "tm20 Soldier", "t2xm Cat"]);
    expect(ids("m20token", "u")).toEqual(["tfdn Ninja", "tsoc Illusion"]);
    expect(ids("m20token", "b")).toEqual(["tfdn Zombie", "tfdc Zombie"]);
    expect(ids("m20token", "r")).toEqual(["tfdn Goblin", "tfic Rebel"]);
    expect(ids("m20token", "g")).toEqual(["tfdn Raccoon", "tpip Squirrel"]);
    expect(ids("m20token", "c")).toEqual(["teoe Sliver", "tcmm Eldrazi"]);
    expect(ids("m20token", "m")).toEqual(["tm3c Sand Warrior", "tdmu Sand Warrior"]);
  });

  it("m20tokentext: the regular box (TFDN #27 Cat, TFDN #26 Copy)", () => {
    expect(ids("m20tokentext", "w")).toEqual(["tfdn Cat", "tfdn Spirit"]);
    expect(ids("m20tokentext", "c")).toEqual(["tmh3 Eldrazi Spawn", "tfdn Copy"]);
    expect(ids("m20tokentext", "m")).toEqual(["ttdm Reliquary Dragon", "tfin Elemental"]);
  });

  it("m20tokentall: the tall box (TBLB #5 Warren Warleader)", () => {
    expect(ids("m20tokentall", "w")).toEqual(["tblb Warren Warleader", "tdrc Angel of Sanctions"]);
    expect(ids("m20tokentall", "u")).toEqual(["tblb Thundertrap Trainer"]);
    for (const key of ["r", "c", "m"] as const) expect(FRAME_REFERENCES.m20tokentall[key]).toBeNull();
  });

  it("the artifact templates: TFDN #23 Treasure, TDSK #7 Toy, TSOC #8 Myr, TMH3 #18 Wurm, TMOC #25 Gremlin, TLCI #17 Map", () => {
    expect(ids("m20tokenartifact", "c")).toEqual(["teoc Golem", "tcmm Servo"]);
    expect(ids("m20tokenartifact", "w")).toEqual(["tdsk Toy"]);
    expect(ids("m20tokenartifact", "u")).toEqual(["tsoc Phyrexian Myr", "tm3c Phyrexian Myr"]);
    expect(ids("m20tokenartifact", "r")).toEqual(["tmoc Gremlin"]);
    expect(ids("m20tokenartifacttext", "c")).toEqual(["tfdn Treasure", "tfdn Food"]);
    expect(ids("m20tokenartifacttext", "b")).toEqual(["tmh3 Phyrexian Wurm", "tmh3 Phyrexian Wurm"]);
    expect(ids("m20tokenartifacttall", "c")).toEqual(["tlci Map", "tmkm Clue"]);
    expect(FRAME_REFERENCES.m20tokenartifacttext.c?.scryfallId).toBe("21210145-8edd-41f5-9a64-9f0b5be79864");
  });

  it("lists only M20+ prints (released from 2019-07-12), none on the 2014–19 arch frames", () => {
    const ARCH = new Set(["tdom", "tm19", "tm15", "tc16", "twar", "tsoi", "txln", "tc17", "tbfz", "togw", "tc18", "tkld", "tmh1", "temn"]);
    for (const template of ["m20token", "m20tokentext", "m20tokentall", "m20tokenartifact", "m20tokenartifacttext", "m20tokenartifacttall"]) {
      for (const key of FRAME_COLOR_KEYS) {
        for (const ref of frameReferenceOptions(template, key)) expect(ARCH.has(ref.set), `${template}/${key} ${ref.set}`).toBe(false);
      }
      expect(frameReferenceNote(template).note).toMatch(/full-art/);
    }
  });
});
