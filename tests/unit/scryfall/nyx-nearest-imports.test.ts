import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { frameComboKey, FRAME_COLOR_KEYS } from "@/lib/cards/frame-reference-registry";
import { pickFrameColorKey } from "@/components/cards/frame-layer";
import { finalizeImportMatch, resolveImportFrame } from "@/lib/creator/frame-resolve";
import { importFramePlan } from "@/lib/creator/import-frame-choice";
import { frameRequestFromImport } from "@/lib/frames/frame-requests";
import { scryfallCardSchema, type ScryfallCard } from "@/lib/scryfall/client";
import { FRAME_SIGNATURE_KEYS, NYX_OWN_FRAME_PINS } from "@/lib/scryfall/frame-signatures";
import { frameMatchFromScryfall, mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import type { FrameTemplate } from "@/types/card";
import printings from "./fixtures/nyx-nearest-printings.json";

// ---------------------------------------------------------------------------
// Owner decision 4, Round 56 (2026-10-13; the follow-up of #542): two groups
// of Nyx printings land on the Nyx frame (`m15nyx`, once it is verified in
// the card's colour) as its NEAREST, never exact —
//   • the ten printings whose only other frame effect is Scryfall's
//     `inverted` (by the flags, no id pinned);
//   • Faceless One, CLB #1: a tan frame of its own on a colourless card
//     (pinned — no Scryfall field tells it from the silver starfield).
// Each says why and writes a frame-request row, as any gap does.
// ---------------------------------------------------------------------------

const P = Object.fromEntries(
  Object.entries(printings).map(([key, raw]) => [key, scryfallCardSchema.parse(raw) as ScryfallCard]),
);

/** Production's verified combos (supabase/seed.sql mirrors them). */
function productionVerifiedKeys(): Set<string> {
  const sql = readFileSync(join(process.cwd(), "supabase/seed.sql"), "utf8");
  const block = /-- frame_reviews:begin\n([\s\S]*?)-- frame_reviews:end/.exec(sql)?.[1].replace(/--.*$/gm, "");
  if (!block) throw new Error("frame_reviews block missing from seed.sql");
  const everyColour = /unnest\(array\[([^\]]*)\]\)\s+as t/.exec(block)?.[1] ?? "";
  const out = new Set<string>();
  for (const [, template] of everyColour.matchAll(/'([^']+)'/g)) {
    for (const colour of FRAME_COLOR_KEYS) out.add(frameComboKey(template as FrameTemplate, colour));
  }
  for (const [, template, colour] of block.matchAll(/\('([^']+)',\s*'([wubrgcm])',\s*true/g)) {
    out.add(frameComboKey(template as FrameTemplate, colour));
  }
  return out;
}
const PROD = productionVerifiedKeys();
/**
 * The unverified side of this suite: production's list WITHOUT its Nyx ticks
 * (production verified `m15nyx` in every colour on 2026-10-14, the seed
 * mirror of that date — so its own list is the verified side now).
 */
const PROD_BEFORE_NYX = new Set([...PROD].filter((key) => !key.startsWith("m15nyx/")));
const NYX_VERIFIED = new Set([...PROD_BEFORE_NYX, ...FRAME_COLOR_KEYS.map((c) => frameComboKey("m15nyx", c))]);

const INVERTED_ONLY = ["thb-353", "prm-79863", "sld-340", "neo-508", "neo-510", "dsk-415", "tdm-420", "tdm-421", "tdm-424", "sch-45"] as const;
const INVERTED_REASON = "Scryfall marks this printing's frame inverted, which PipGlyph's Nyx frame doesn't claim to match yet";
const OWN_FRAME_REASON = "this printing has a Nyx frame of its own colour, and PipGlyph's Nyx frame draws the silver one for a colourless card";

const imported = (key: string, verified: ReadonlySet<string>) => finalizeImportMatch(mapScryfallToFormPatch(P[key]), verified);

describe("Nyx printings the Nyx frame doesn't match land on it as its nearest", () => {
  it("production has verified the frame in every colour: the unverified side is production's list without those ticks", () => {
    for (const key of FRAME_COLOR_KEYS) {
      expect(PROD.has(frameComboKey("m15nyx", key)), key).toBe(true);
      expect(PROD_BEFORE_NYX.has(frameComboKey("m15nyx", key)), key).toBe(false);
    }
    expect([...NYX_VERIFIED].sort()).toEqual([...PROD].sort());
  });

  it("adds no signature: both are gaps of the frame taken once verified, under era/2015+nyx", () => {
    expect(FRAME_SIGNATURE_KEYS.filter((key) => /nyx-inverted|nyx-own-frame/.test(key))).toEqual([]);
    for (const key of [...INVERTED_ONLY, "clb-1"]) {
      const match = frameMatchFromScryfall(P[key]);
      expect(match, key).toMatchObject({
        signature: "era/2015+nyx",
        status: "nearest",
        template: "m15",
        reason: "PipGlyph doesn't draw the Nyx starfield on this frame yet",
        blockedBy: "4.7",
        onceVerified: "m15nyx",
      });
      // Before the swap the match lists the starfield alone, as it did.
      expect(match.gaps, key).toEqual(["nyx"]);
    }
  });

  it("the ten `inverted`-only printings: nearest on the Nyx frame once verified, for the flag", () => {
    for (const key of INVERTED_ONLY) {
      expect(P[key].frame_effects, key).toEqual(expect.arrayContaining(["enchantment", "inverted"]));
      expect(frameMatchFromScryfall(P[key]).onceVerifiedMatch, key).toEqual({
        status: "nearest",
        reason: INVERTED_REASON,
        blockedBy: "4.7",
        gaps: ["nyx-inverted"],
      });
      const patch = imported(key, NYX_VERIFIED);
      expect(patch.frame_template, key).toBe("m15nyx");
      expect(patch.frame_match, key).toMatchObject({ status: "nearest", template: "m15nyx", reason: INVERTED_REASON, blockedBy: "4.7", gaps: ["nyx-inverted"] });
      expect(patch.frame_match?.unverified, key).toBeUndefined();
      expect(patch.frame_match?.landOn, key).toBeUndefined();
    }
  });

  it("Faceless One (CLB #1): nearest on the colourless key, for its own tan frame — the one pin", () => {
    expect(NYX_OWN_FRAME_PINS).toEqual({ clb: ["1"] });
    expect(P["clb-1"]).toMatchObject({ name: "Faceless One", colors: [] });
    expect(frameMatchFromScryfall(P["clb-1"]).onceVerifiedMatch).toEqual({
      status: "nearest",
      reason: OWN_FRAME_REASON,
      blockedBy: "4.7",
      gaps: ["nyx-own-frame"],
    });
    const patch = imported("clb-1", NYX_VERIFIED);
    expect(pickFrameColorKey(patch.color_identity)).toBe("c");
    expect(patch.frame_template).toBe("m15nyx");
    expect(patch.frame_match).toMatchObject({ status: "nearest", template: "m15nyx", reason: OWN_FRAME_REASON, gaps: ["nyx-own-frame"] });
    // The legendary crown comes along, as on any Nyx printing.
    expect(patch.printed_crown).toBe(true);
  });

  it("the silver colourless printing stays exact (Eldrazi Conscription, SOC #131: same flags, no pin)", () => {
    expect(frameMatchFromScryfall(P["soc-131"]).onceVerifiedMatch).toEqual({ status: "exact", reason: null });
    const patch = imported("soc-131", NYX_VERIFIED);
    expect(patch.frame_template).toBe("m15nyx");
    expect(patch.frame_match).toMatchObject({ status: "exact", template: "m15nyx", reason: null });
    expect(patch.frame_match?.gaps).toBeUndefined();
  });

  it("an earlier gap keeps the reason: foil-etched, a yellow border — `inverted` listed after it", () => {
    const etched = imported("cmr-522", NYX_VERIFIED).frame_match;
    expect(etched).toMatchObject({ status: "nearest", template: "m15nyx", reason: "PipGlyph doesn't have the foil-etched frame yet", blockedBy: "4.28" });
    expect(etched?.gaps).toEqual(["etched", "nyx-inverted"]);
    const yellow = imported("dft-442", NYX_VERIFIED).frame_match;
    expect(yellow).toMatchObject({ status: "nearest", template: "m15nyx", reason: "PipGlyph doesn't print a yellow border yet", blockedBy: "4.30" });
    expect(yellow?.gaps).toEqual(["border", "nyx-inverted"]);
  });

  it("an `inverted` Nyx printing an earlier rule names never reaches the gap (the THB constellation showcase)", () => {
    const match = frameMatchFromScryfall(P["thb-259"]);
    expect(match).toMatchObject({ signature: "showcase/thb/constellation", template: "nyx" });
    expect(match.onceVerified).toBeUndefined();
    expect(match.onceVerifiedMatch).toBeUndefined();
  });

  it("while the frame is unverified they land on M15 as before, saying the starfield isn't drawn — a 'missing' row, not 'not yet verified'", () => {
    for (const key of [...INVERTED_ONLY, "clb-1"]) {
      const patch = imported(key, PROD_BEFORE_NYX);
      expect(patch.frame_template === "m15" || patch.frame_template === "m15artifact", key).toBe(true);
      expect(patch.frame_match, key).toMatchObject({
        status: "nearest",
        template: patch.frame_template,
        reason: "PipGlyph doesn't draw the Nyx starfield on this frame yet",
        gaps: ["nyx"],
      });
      // Verifying the frame would not make this printing exact, so the
      // request log files it under "Missing frames".
      expect(patch.frame_match?.unverified, key).toBeUndefined();
      expect(frameRequestFromImport(patch, { artImported: false, source: "import" }), key).toMatchObject({
        signature: "era/2015+nyx",
        status: "nearest",
        cause: "missing",
        template: patch.frame_template,
      });
    }
  });

  it("verified: each writes a frame-request row on the Nyx frame, and the import asks nothing it didn't ask of any nearest landing", () => {
    for (const key of [...INVERTED_ONLY, "clb-1"]) {
      const patch = imported(key, NYX_VERIFIED);
      expect(frameRequestFromImport(patch, { artImported: false, source: "import" }), key).toEqual(
        expect.objectContaining({ signature: "era/2015+nyx", status: "nearest", cause: "missing", template: "m15nyx" }),
      );
      const { resolution } = resolveImportFrame({
        patch,
        kind: patch.kind ?? null,
        current: { template: null, cardType: patch.card_type ?? null, colors: patch.color_identity ?? ["colorless"] },
        verifiedKeys: NYX_VERIFIED,
      });
      expect(resolution, key).toMatchObject({ template: "m15nyx" });
      // The same plan the foil-etched Nyx printing gets: a nearest landing.
      expect(importFramePlan(patch, NYX_VERIFIED).mode, key).toBe(importFramePlan(imported("cmr-522", NYX_VERIFIED), NYX_VERIFIED).mode);
    }
  });
});
