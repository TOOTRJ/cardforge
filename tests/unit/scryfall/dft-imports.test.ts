import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { finalizeImportMatch, remixFrameFor } from "@/lib/creator/frame-resolve";
import { remixCreditsOf, scryfallRemixMechanics } from "@/lib/ai/remix-mechanics";
import { doubleFacedTokenShapeOf, droppedFaceNotice, mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import { scryfallCardSchema, type ScryfallCard } from "@/lib/scryfall/client";
import printingsData from "./fixtures/dft-printings.json";

// ---------------------------------------------------------------------------
// TODO 5.5 (c) — every printing Scryfall lays out as `double_faced_token`
// (2026-10-21: 121, fixtures/dft-printings.json) through the import and the
// AI remix's landing, against origin/main (fixtures/dft-main-landings.json,
// recorded on origin/main dff6baf8 by this file with DFT_CAPTURE set):
//   • two tokens back to back (owner Round 76) bring BOTH faces once both
//     faces' tokens are verified, each in its colour — the back on the token
//     template its own words and text derive in the front's design; the
//     patch is main's but for the back it gains and the `dropped_face` it
//     loses; MOM's transforming Incubator // Phyrexian lands on the plain
//     full-art pair, NEAREST (the `dfc-token-transform` gap, TODO 5.5 (d));
//   • short of either tick, exactly main's patch (the front alone, the toast);
//   • F18 #2 City's Blessing // Elemental imports its token face by itself;
//   • everything else — Unstable's art-only backs, the folded Contortionist,
//     a token backed by a helper card, every helper card — exactly as main.
// ---------------------------------------------------------------------------

const printings = Object.fromEntries(
  Object.entries(printingsData as Record<string, unknown>)
    .filter(([key]) => key !== "_note")
    .map(([key, card]) => [key, scryfallCardSchema.parse(card) as ScryfallCard]),
);
const KEYS = ["w", "u", "b", "r", "g", "c", "m"];

/** Production's verified combos (supabase/seed.sql's frame_reviews block). */
function productionKeys(): Set<string> {
  const sql = fs.readFileSync(path.join(process.cwd(), "supabase/seed.sql"), "utf8");
  const block = /-- frame_reviews:begin\n([\s\S]*?)-- frame_reviews:end/.exec(sql)?.[1].replace(/--.*$/gm, "") ?? "";
  const everyColour = /unnest\(array\[([^\]]*)\]\)\s+as t/.exec(block)?.[1] ?? "";
  const out = new Set<string>();
  for (const [, template] of everyColour.matchAll(/'([^']+)'/g)) for (const k of KEYS) out.add(frameComboKey(template as never, k));
  for (const [, template, colour] of block.matchAll(/\('([^']+)',\s*'([wubrgcm])',\s*true/g)) out.add(frameComboKey(template as never, colour));
  return out;
}
const PROD = productionKeys();
/** …and the same with no token template verified at all. */
const NO_TOKENS = new Set([...PROD].filter((key) => !/^m(15|20)token/.test(key)));

/** The finalized patch as the creator is handed it, without its frame match,
 *  and where the remix lands. */
function landingOf(card: ScryfallCard, verified: ReadonlySet<string>) {
  const patch = finalizeImportMatch(mapScryfallToFormPatch(card, { artPreviewUrl: null }) as never, verified) as Record<string, unknown>;
  const { frame_match: _match, ...rest } = patch;
  void _match;
  const remix = remixFrameFor(mapScryfallToFormPatch(card, { artPreviewUrl: null }) as never, verified);
  return { patch: JSON.parse(JSON.stringify(rest)) as Record<string, unknown>, remix: remix.ok ? remix.template : remix.error };
}
const matchOf = (card: ScryfallCard, verified: ReadonlySet<string>) =>
  (finalizeImportMatch(mapScryfallToFormPatch(card) as never, verified) as { frame_match?: { status?: string; signature?: string; blockedBy?: unknown; reason?: string | null } }).frame_match;

const capture = process.env.DFT_CAPTURE;

describe.skipIf(!capture)("recording (on origin/main)", () => {
  it("writes every printing's landing", () => {
    const landings = Object.fromEntries(
      Object.entries(printings).map(([key, card]) => [key, { prod: landingOf(card, PROD), noTokens: landingOf(card, NO_TOKENS) }]),
    );
    fs.writeFileSync(capture!, JSON.stringify({ base: "origin/main", landings }, null, 1) + "\n");
  });
});

/** The two-token pairs on the token designs PipGlyph draws. */
const PAIRS = [
  ...["1", "2", "3", "4", "5", "6", "8", "9", "10", "11"].map((n) => `tgk1-${n}`),
  "f17-10", "f17-11", "f17-12", "f18-1", "f18-3", "l16-5", "ta25-5★", "pemn-1Z", "cc2-9", "q07-T12",
  "tmom-16", "tmom-17", "tmom-18", "teoc-15", "tfrc-13",
  // Global Series Mowu and the two 2003-frame pairs: both faces, nearest.
  "gs1-T1", "f12-1a", "phel-1★",
];
const INCUBATORS = ["tmom-16", "tmom-17", "tmom-18", "teoc-15", "tfrc-13"];

describe.skipIf(Boolean(capture))("double-faced token imports (TODO 5.5 (c))", () => {
  let recorded: Record<string, { prod: { patch: Record<string, unknown>; remix: unknown }; noTokens: { patch: Record<string, unknown>; remix: unknown } }> | null = null;
  const main = () =>
    (recorded ??= JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests/unit/scryfall/fixtures/dft-main-landings.json"), "utf8")).landings)!;

  it("covers every printing the recording does", () => {
    expect(Object.keys(printings).sort()).toEqual(Object.keys(main()).sort());
    expect(Object.keys(printings)).toHaveLength(121);
  });

  it("sorts the 121: 28 pairs, F18 #2's token face, the rest front-only", () => {
    const shapes = Object.fromEntries(Object.entries(printings).map(([key, card]) => [key, doubleFacedTokenShapeOf(card)]));
    expect(Object.keys(shapes).filter((key) => shapes[key] === "pair").sort()).toEqual([...PAIRS].sort());
    expect(Object.keys(shapes).filter((key) => shapes[key] === "helper-front")).toEqual(["f18-2"]);
    expect(Object.values(shapes).filter((shape) => shape === "front-only")).toHaveLength(121 - PAIRS.length - 1);
  });

  it("with no token template verified: every printing imports (and remixes) exactly as on origin/main — but F18 #2's token face", () => {
    const changed = Object.entries(printings)
      .filter(([key, card]) => JSON.stringify(landingOf(card, NO_TOKENS)) !== JSON.stringify(main()[key].noTokens))
      .map(([key]) => key);
    expect(changed).toEqual(["f18-2"]);
  });

  it("on production's verified combos: exactly the pairs gain their back (and lose the toast); nothing else moves but F18 #2", () => {
    const changed: string[] = [];
    for (const [key, card] of Object.entries(printings)) {
      const now = landingOf(card, PROD);
      const was = main()[key].prod;
      if (JSON.stringify(now) === JSON.stringify(was)) continue;
      changed.push(key);
      if (key === "f18-2") continue;
      // The pair: main's patch with the back added and the toast gone.
      const { back_face: back, ...rest } = now.patch;
      const { dropped_face: dropped, ...wasRest } = was.patch;
      expect(dropped, key).toBe("double-faced-token");
      expect(rest, key).toEqual(wasRest);
      expect((back as { frame_style?: { template?: string } }).frame_style?.template, key).toMatch(/^m(15|20)token/);
      expect(now.remix, key).toEqual(was.remix);
    }
    expect(changed.sort()).toEqual([...PAIRS, "f18-2"].sort());
  });

  it("each face on the token its own words and text pick, in the front's design and colour", () => {
    const faces = (key: string) => {
      const { patch } = landingOf(printings[key], PROD);
      const back = patch.back_face as { frame_style: { template: string }; color_identity: string[]; card_type: string; supertype?: string; title: string };
      return [patch.frame_template, patch.color_identity, back.frame_style.template, back.color_identity, back.card_type, back.supertype ?? null, back.title];
    };
    expect(faces("tgk1-4")).toEqual(["m15token", ["red"], "m15tokentext", ["white"], "token", "Creature", "Soldier"]);
    expect(faces("f17-11")).toEqual(["m15tokentext", ["green"], "m15tokenartifacttext", ["colorless"], "token", "Artifact", "Treasure"]);
    expect(faces("l16-5")).toEqual(["m15tokenartifact", ["colorless"], "m15tokenartifacttext", ["colorless"], "token", "Artifact Creature", "Thopter"]);
    expect(faces("q07-T12")).toEqual(["m20token", ["red"], "m20tokenartifacttext", ["colorless"], "token", "Artifact", "Blood"]);
    expect(faces("tgk1-6")).toEqual(["m15token", ["multicolor"], "m15token", ["red"], "token", "Creature", "Goblin"]);
    expect(faces("tgk1-1")).toEqual(["m15token", ["colorless"], "m15tokentext", ["multicolor"], "token", "Creature", "Horror"]);
    for (const key of INCUBATORS) {
      expect(faces(key), key).toEqual(["m20tokenartifacttext", ["colorless"], "m20tokenartifact", ["colorless"], "token", "Artifact Creature", "Phyrexian"]);
    }
  });

  it("the Incubator lands NEAREST on the plain full-art pair: the `dfc-token-transform` gap, waiting on 5.5 (d)", () => {
    for (const key of INCUBATORS) {
      const match = matchOf(printings[key], PROD);
      expect(match?.status, key).toBe("nearest");
      expect(String(match?.signature), key).toContain("dfc-token-transform");
      expect(match?.reason, key).toContain("this token transforms");
      expect(match?.blockedBy, key).toBe("5.5d");
    }
    // …and no other printing names the gap.
    for (const [key, card] of Object.entries(printings)) {
      if (INCUBATORS.includes(key)) continue;
      expect(String(matchOf(card, PROD)?.signature ?? ""), key).not.toContain("dfc-token-transform");
    }
  });

  it("both faces or neither: a back whose token isn't verified in its colour leaves the front alone, as main", () => {
    // GK1 #4's back is a white text-box arch: unticked in white only.
    const noWhiteText = new Set([...PROD].filter((key) => key !== frameComboKey("m15tokentext" as never, "w")));
    expect(landingOf(printings["tgk1-4"], noWhiteText)).toEqual(main()["tgk1-4"].prod);
    // …and a front unticked in its colour the same.
    const noRedArch = new Set([...PROD].filter((key) => key !== frameComboKey("m15token" as never, "r")));
    expect(landingOf(printings["tgk1-4"], noRedArch).patch.back_face).toBeUndefined();
    expect(landingOf(printings["tgk1-4"], noRedArch).patch.dropped_face).toBe("double-faced-token");
  });

  it("F18 #2 City's Blessing // Elemental imports its Elemental token by itself, and says so", () => {
    const { patch } = landingOf(printings["f18-2"], PROD);
    expect([patch.kind, patch.title, patch.card_type, patch.supertype, patch.frame_template, patch.color_identity]).toEqual([
      "token", "Elemental", "token", "Creature", "m15tokentext", ["red"],
    ]);
    expect(patch.back_face).toBeUndefined();
    expect(patch.dropped_face).toBe("helper-front");
    expect(patch.source_scryfall_id).toBe(printings["f18-2"].id);
    expect(droppedFaceNotice(patch as never, printings["f18-2"].name)).toBe(
      "City's Blessing // Elemental pairs a reminder card with a token — PipGlyph imported its token face, Elemental.",
    );
  });

  it("the remix follows the import: a pair is two pictures (2 credits), one-faced on a one-credit plan or short of the ticks", () => {
    for (const key of PAIRS) {
      const patch = mapScryfallToFormPatch(printings[key]);
      const two = scryfallRemixMechanics(patch, key, PROD);
      const one = scryfallRemixMechanics(patch, key, PROD, { singleFace: true });
      const none = scryfallRemixMechanics(patch, key, NO_TOKENS);
      expect(two.ok && remixCreditsOf(two.mechanics), key).toBe(2);
      expect(one.ok && remixCreditsOf(one.mechanics), key).toBe(1);
      expect(none.ok ? remixCreditsOf(none.mechanics) : 1, key).toBe(1);
      if (two.ok) {
        expect(two.mechanics.back_face?.card_type, key).toBe("token");
        expect(two.mechanics.back_face?.frame_style?.template, key).toMatch(/^m(15|20)token/);
      }
    }
    // Every other printing stays one picture.
    for (const [key, card] of Object.entries(printings)) {
      if (PAIRS.includes(key)) continue;
      const mechanics = scryfallRemixMechanics(mapScryfallToFormPatch(card), key, PROD);
      expect(mechanics.ok ? remixCreditsOf(mechanics.mechanics) : 1, key).toBe(1);
    }
  });
});
