import { describe, expect, it, vi } from "vitest";
import dfcPrintings from "../scryfall/fixtures/dfc-import-printings.json";
import provenanceJson from "@/lib/cards/frame-sources.json";
import manifestJson from "@/lib/frames/frame-manifest.json";
import { scryfallCardSchema, type ScryfallCard } from "@/lib/scryfall/client";
import { dfcImportOf, frameMatchFromScryfall, mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import { dfcImportLanding } from "@/lib/scryfall/dfc-import";
import { finalizeImportMatch } from "@/lib/creator/frame-resolve";
import {
  SEE_THROUGH_COLORLESS_SINCE_LAYOUT_VERSION,
  colorlessFaceAllowed,
  colorlessFaceFits,
  hasSeeThroughColorless,
  seeThroughColorlessKey,
  seeThroughTickKeys,
} from "@/lib/cards/dfc";
import {
  DFC_COLORLESS_FRONT_NEEDS_ARTIFACT,
  DFC_COLORLESS_NEEDS_ARTIFACT,
  DFC_SEE_THROUGH_UNVERIFIED,
  dfcColorlessRefusal,
  dfcFrontColorError,
  resolveDfcBackFace,
} from "@/lib/cards/dfc-gate";
import { CARD_LAYOUT_VERSION } from "@/lib/cards/layout-version";
import { artLayersFor, getFrameProfile, underFrameArtRect } from "@/lib/cards/template-layout";
import { frameMasterKey } from "@/components/cards/frame-layer";
import { stripKeyOf } from "@/lib/cards/faces";
import { resolveFrameOverlays } from "@/lib/cards/anatomy";
import { verificationState } from "@/lib/cards/frame-verification-state";
import { verifiedKeysOfRows } from "@/lib/cards/frame-reviews";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { dfcColorHints, dfcSeeThroughColorlessOffered, lintDfcDesign } from "@/lib/ai/dfc-design";
import {
  ARROW_LUMA_GAP,
  BACK_LUMA_GAINS,
  FRONT_STRIP_TONE,
  MDFC_COLOURLESS_BODIES,
  housingGlyphWeight,
  scaleThrough,
  toneThrough,
} from "../../../scripts/lib/mdfc-colourless.mjs";
import type { FrameTemplate } from "@/types/card";

vi.mock("server-only", () => ({}));

// ---------------------------------------------------------------------------
// TODO 5.11a — the colourless modal card, STX #6 Wandering Archaic // Explore
// the Vastlands: the modal spell bodies' `c` is the SEE-THROUGH colourless
// frame (scripts/build-mdfc-colourless-frames.mjs), a colourless face with no
// Artifact word may wear it once its `c` row is ticked AGAIN (the old tick
// verified the artifact stand-in), and the import lands STX #6 / PSTX #6s on
// the bodies then. The transform bodies are untouched (5.11).
// ---------------------------------------------------------------------------

const printing = (key: string): ScryfallCard => scryfallCardSchema.parse((dfcPrintings as Record<string, unknown>)[key]);
const keys = (...combos: [string, string][]) => new Set(combos.map(([template, colour]) => frameComboKey(template as FrameTemplate, colour)));
/** Production's ticks: both modal bodies in all seven keys (the `c` ones
 *  against the artifact stand-in, layout v41). */
const ALL_KEYS = ["w", "u", "b", "r", "g", "c", "m"] as const;
const TICKED = keys(...(["m15mdfcfront", "m15mdfcback", "m15mdfclandfront", "m15mdfclandback", "m15", "m15artifact", "m15land"] as const).flatMap((t) => ALL_KEYS.map((k) => [t, k] as [string, string])));
const SEE_THROUGH = new Set([...TICKED, seeThroughColorlessKey("m15mdfcfront"), seeThroughColorlessKey("m15mdfcback")]);
const AVATAR = { cardType: "creature", supertype: null };
const SORCERY = { cardType: "sorcery", supertype: null };
const ARTIFACT = { cardType: "artifact", supertype: null };

describe("the see-through masters (scripts/lib/mdfc-colourless.mjs)", () => {
  it("builds the two spell bodies' `c` from their artifact masters and m15/c, recorded in provenance; the manifest publishes both masters and both strip pieces", () => {
    expect(Object.keys(MDFC_COLOURLESS_BODIES)).toEqual(["m15mdfcfront", "m15mdfcback"]);
    const record = (provenanceJson as Record<string, { colors: Record<string, string[]>; converter: string }>).mdfccolourless;
    expect(record.converter).toBe("scripts/build-mdfc-colourless-frames.mjs");
    expect(Object.keys(record.colors).sort()).toEqual(["m15mdfcback/c", "m15mdfcback/strip/c", "m15mdfcfront/c", "m15mdfcfront/strip/c"]);
    const files = (manifestJson as { files: Record<string, { sha256: string }> }).files;
    for (const t of ["m15mdfcfront", "m15mdfcback"]) {
      for (const f of [`${t}/c.png`, `${t}/c.webp`, `${t}/strip/c.png`, `${t}/strip/c.webp`]) expect(files[f], f).toBeDefined();
      // No longer the artifact master's bytes.
      expect(files[`${t}/c.png`].sha256).not.toBe(files[`${t}/a.png`].sha256);
    }
    // The importer leaves the key to the builder, and says so.
    const sources = provenanceJson as Record<string, { colors: Record<string, string[]>; excluded?: Record<string, string> }>;
    for (const t of ["m15mdfcfront", "m15mdfcback"]) {
      expect(sources[t].excluded?.c).toMatch(/build-mdfc-colourless-frames/);
      expect(sources[t].colors.c[0]).toMatch(/^NOT IMPORTED/);
    }
  });

  it("the back's pieces at print's back ÷ front luma (STX #6, both faces); the front strip onto print's warm grey tab", () => {
    const luma = ([r, g, b]: readonly number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    // The header's readings: title, type, box — back ÷ front.
    expect(BACK_LUMA_GAINS.title).toBeCloseTo(luma([156, 150, 154]) / luma([212, 209, 223]), 2);
    expect(BACK_LUMA_GAINS.type).toBeCloseTo(luma([140, 133, 138]) / luma([199, 196, 211]), 2);
    expect(BACK_LUMA_GAINS.rules).toBeCloseTo(luma([176, 174, 184]) / luma([196, 196, 213]), 2);
    expect(FRONT_STRIP_TONE.to).toEqual([120, 106, 104]);
  });

  it("a housing pixel is glyph by its distance from the bar's luma in its row: the fill stays the bar's, the ▲ (black) and ▲▼ (white) come through whole", () => {
    expect(housingGlyphWeight(200, 200)).toBe(0);
    expect(housingGlyphWeight(200 - ARROW_LUMA_GAP, 200)).toBe(0);
    expect(housingGlyphWeight(0, 200)).toBe(1);
    expect(housingGlyphWeight(255, 140)).toBe(1);
    const half = housingGlyphWeight(100, 200);
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(1);
  });

  it("scaleThrough multiplies colour through a mask (alpha kept); toneThrough tones the tab's fill and leaves its white ◀ alone", () => {
    const px = Buffer.from([200, 200, 200, 212, 200, 200, 200, 212]);
    scaleThrough(px, new Uint8Array([255, 0]), 0.5);
    expect([...px]).toEqual([100, 100, 100, 212, 200, 200, 200, 212]);
    const strip = Buffer.from([...FRONT_STRIP_TONE.from, 255, 250, 250, 250, 255]);
    toneThrough(strip, new Uint8Array([255, 255]), FRONT_STRIP_TONE);
    expect([...strip.subarray(0, 3)]).toEqual(FRONT_STRIP_TONE.to);
    expect([...strip.subarray(4, 7)]).toEqual([250, 250, 250]);
  });
});

describe("the profiles: the modal spell bodies' `c` is see-through, nothing else changed", () => {
  it("m15mdfcfront and m15mdfcback draw the art under the frame for `c` (m15's rect); a colourless ARTIFACT face wears `a`, which draws none", () => {
    for (const t of ["m15mdfcfront", "m15mdfcback"] as const) {
      const profile = getFrameProfile(t);
      expect(hasSeeThroughColorless(t), t).toBe(true);
      expect(underFrameArtRect(profile, "c"), t).toEqual(underFrameArtRect(getFrameProfile("m15"), "c"));
      expect(underFrameArtRect(profile, "a"), t).toBeNull();
      expect(artLayersFor(profile, "c", true).under, t).not.toBeNull();
      // The master a face draws: `c` for an Avatar, `a` for an artifact.
      expect(frameMasterKey(profile, ["colorless"], AVATAR as never), t).toBe("c");
      expect(frameMasterKey(profile, ["colorless"], ARTIFACT as never), t).toBe("a");
      for (const k of ["w", "u", "b", "r", "g", "m"]) expect(underFrameArtRect(profile, k), `${t}/${k}`).toBeNull();
    }
    for (const t of ["m15dfcfront", "m15dfcback", "m15dfcbackleft", "m15mdfclandfront", "m15mdfclandback", "m15borderlessmdfcfront", "m15borderlessmdfcback", "sagadfcfront"] as const) {
      expect(hasSeeThroughColorless(t), t).toBe(false);
      expect(underFrameArtRect(getFrameProfile(t), "c"), t).toBeNull();
    }
  });
});

describe("the gate (lib/cards/dfc.ts, lib/cards/dfc-gate.ts)", () => {
  it("colorlessFaceFits: the modal spell bodies take any colourless face; the transform bodies an Artifact one only (5.11)", () => {
    for (const t of ["m15mdfcfront", "m15mdfcback"]) {
      expect(colorlessFaceFits(t, AVATAR), t).toBe(true);
      expect(colorlessFaceFits(t, SORCERY), t).toBe(true);
      expect(colorlessFaceFits(t, ARTIFACT), t).toBe(true);
    }
    for (const t of ["m15dfcfront", "m15dfcback", "m15dfcbackleft", "m15borderlessmdfcfront", "m15borderlessmdfcback"]) {
      expect(colorlessFaceFits(t, AVATAR), t).toBe(false);
      expect(colorlessFaceFits(t, ARTIFACT), t).toBe(true);
    }
  });

  it("colorlessFaceAllowed: on the see-through `c` only once it is ticked again (its key); an artifact face always; null skips verification; the transform bodies never", () => {
    for (const t of ["m15mdfcfront", "m15mdfcback"]) {
      expect(colorlessFaceAllowed(t, AVATAR, TICKED), t).toBe(false);
      expect(colorlessFaceAllowed(t, AVATAR, SEE_THROUGH), t).toBe(true);
      expect(colorlessFaceAllowed(t, AVATAR, null), t).toBe(true);
      expect(colorlessFaceAllowed(t, ARTIFACT, new Set()), t).toBe(true);
    }
    const everything = new Set([...SEE_THROUGH, seeThroughColorlessKey("m15dfcfront"), seeThroughColorlessKey("m15dfcback")]);
    expect(colorlessFaceAllowed("m15dfcfront", AVATAR, everything)).toBe(false);
    expect(colorlessFaceAllowed("m15dfcback", AVATAR, null)).toBe(false);
  });

  it("dfcFrontColorError: the modal front says the frame isn't published yet, then passes; the transform front still asks for the Artifact word", () => {
    expect(dfcFrontColorError("m15mdfcfront", AVATAR, ["colorless"], TICKED)).toBe(DFC_SEE_THROUGH_UNVERIFIED);
    expect(dfcFrontColorError("m15mdfcfront", AVATAR, ["colorless"], SEE_THROUGH)).toBeNull();
    expect(dfcFrontColorError("m15mdfcfront", AVATAR, [], null)).toBeNull();
    expect(dfcFrontColorError("m15mdfcfront", ARTIFACT, ["colorless"], new Set())).toBeNull();
    expect(dfcFrontColorError("m15dfcfront", AVATAR, ["colorless"], SEE_THROUGH)).toBe(DFC_COLORLESS_FRONT_NEEDS_ARTIFACT);
    expect(dfcColorlessRefusal("m15mdfcback", SORCERY, TICKED, "back")).toBe(DFC_SEE_THROUGH_UNVERIFIED);
    expect(dfcColorlessRefusal("m15mdfcback", SORCERY, SEE_THROUGH, "back")).toBeNull();
    expect(dfcColorlessRefusal("m15dfcback", AVATAR, SEE_THROUGH, "back")).toBe(DFC_COLORLESS_NEEDS_ARTIFACT);
  });

  const ARCHAIC_BACK = { title: "Explore the Vastlands", cost: "{3}", card_type: "sorcery", supertype: null, rules_text: "Each player gains 3 life." };

  it("resolveDfcBackFace: Wandering Archaic's back on the modal back in colourless — an unverified refusal (the admin preview's to skip) until ticked, then stored", () => {
    const input = { frontTemplate: "m15mdfcfront", back: ARCHAIC_BACK, family: null, frontColorIdentity: ["colorless" as const] };
    const before = resolveDfcBackFace({ ...input, verifiedKeys: TICKED });
    expect(before).toMatchObject({ ok: false, field: "back_face.color_identity", message: DFC_SEE_THROUGH_UNVERIFIED, code: "unverified" });
    expect(resolveDfcBackFace({ ...input, verifiedKeys: TICKED, skipVerification: true }).ok).toBe(true);
    const after = resolveDfcBackFace({ ...input, verifiedKeys: SEE_THROUGH });
    expect(after.ok && after.back).toMatchObject({ frame_style: { template: "m15mdfcback" }, color_identity: ["colorless"], cost: "{3}" });
    // A stored see-through back keeps editing once the tick is withdrawn
    // (the legacy pin: body and colour unchanged).
    const stored = { ...ARCHAIC_BACK, frame_style: { template: "m15mdfcback" }, color_identity: ["colorless" as const] };
    expect(resolveDfcBackFace({ ...input, back: stored, verifiedKeys: new Set(), stored: { back: stored, familyChanged: false } }).ok).toBe(true);
    // The transform back still refuses the face outright.
    const transform = resolveDfcBackFace({ frontTemplate: "m15dfcfront", back: { ...ARCHAIC_BACK, card_type: "creature", cost: "" }, family: "arrows", frontColorIdentity: ["colorless"], verifiedKeys: SEE_THROUGH });
    expect(transform).toMatchObject({ ok: false, message: DFC_COLORLESS_NEEDS_ARTIFACT });
  });
});

describe("the see-through tick (lib/cards/dfc.ts seeThroughTickKeys)", () => {
  it("ships at the current layout version, no bump", () => {
    expect(SEE_THROUGH_COLORLESS_SINCE_LAYOUT_VERSION).toBe(CARD_LAYOUT_VERSION);
  });

  it("a `c` tick made before (production's, v41) publishes nothing; one at the version or later publishes the body's see-through key; never for a transform body or another colour", () => {
    expect(seeThroughTickKeys([{ template: "m15mdfcfront", color_key: "c", verified_layout_version: 41 }])).toEqual([]);
    expect(seeThroughTickKeys([{ template: "m15mdfcfront", color_key: "c", verified_layout_version: null }])).toEqual([]);
    expect(
      seeThroughTickKeys([
        { template: "m15mdfcfront", color_key: "c", verified_layout_version: SEE_THROUGH_COLORLESS_SINCE_LAYOUT_VERSION },
        { template: "m15mdfcback", color_key: "c", verified_layout_version: SEE_THROUGH_COLORLESS_SINCE_LAYOUT_VERSION + 3 },
        { template: "m15mdfcfront", color_key: "w", verified_layout_version: 99 },
        { template: "m15dfcfront", color_key: "c", verified_layout_version: 99 },
        { template: "m15", color_key: "c", verified_layout_version: 99 },
        { template: "m15mdfcback", color_key: "c", verified: false, verified_layout_version: 99 },
      ]),
    ).toEqual([seeThroughColorlessKey("m15mdfcfront"), seeThroughColorlessKey("m15mdfcback")]);
    expect(verifiedKeysOfRows([{ template: "m15mdfcfront", color_key: "c", verified_layout_version: 80 }])).toEqual([
      "m15mdfcfront/c",
      seeThroughColorlessKey("m15mdfcfront"),
    ]);
  });

  it("the admin checklist asks for the re-tick: a modal `c` row ticked before is stale with the reason; ticked since, it isn't; no other row moves", () => {
    const at = (template: string, colorKey: string, version: number | null) =>
      verificationState({ verified: true, verifiedLayoutVersion: version, verifiedOverrideHash: "none", colorKey }, template, "none");
    const old = at("m15mdfcfront", "c", 41);
    expect(old.stale).toBe(true);
    expect(old.reasons.join(" ")).toMatch(/see-through frame/);
    expect(at("m15mdfcback", "c", 41).stale).toBe(true);
    expect(at("m15mdfcfront", "c", SEE_THROUGH_COLORLESS_SINCE_LAYOUT_VERSION).reasons.join(" ")).not.toMatch(/see-through/);
    expect(at("m15mdfcfront", "w", 41).reasons.join(" ")).not.toMatch(/see-through/);
    expect(at("m15dfcfront", "c", 41).reasons.join(" ")).not.toMatch(/see-through/);
    // A caller that names no colour sees no new reason.
    expect(verificationState({ verified: true, verifiedLayoutVersion: 41, verifiedOverrideHash: "none" }, "m15mdfcfront", "none").reasons.join(" ")).not.toMatch(/see-through/);
  });
});

describe("the flipside strip's colourless keys (stripKeyOf, the rider)", () => {
  it("a colourless artifact face is `a` (the master it wears), a colourless face with no Artifact word `c`; a land the grey `l` as before", () => {
    expect(stripKeyOf({ colorIdentity: [], cardType: "artifact" })).toBe("a");
    expect(stripKeyOf({ colorIdentity: ["colorless"], cardType: "creature", supertype: "Artifact" })).toBe("a");
    expect(stripKeyOf({ colorIdentity: ["colorless"], cardType: "sorcery" })).toBe("c");
    expect(stripKeyOf({ colorIdentity: [], cardType: "creature" })).toBe("c");
    expect(stripKeyOf({ colorIdentity: [], cardType: "land" })).toBe("l");
  });

  const stripOf = (template: FrameTemplate, colorKey: string, face: { cardType: string; supertype?: string | null }, other: string) =>
    resolveFrameOverlays(getFrameProfile(template), {}, {
      colorKey,
      colors: colorKey === "c" ? ["colorless"] : undefined,
      cardType: face.cardType,
      supertype: face.supertype ?? null,
      dfc: { role: getFrameProfile(template).dfc!.role, icon: null, stripKey: other },
    } as never).filter((o) => o.anatomy === "mdfcStrip");

  it("Wandering Archaic draws no rider (its other face's `c` is its own master's tab); a coloured face beside a colourless sorcery draws the `c` piece; the artifact routes keep the `a` piece", () => {
    expect(stripOf("m15mdfcfront", "c", AVATAR, "c")).toEqual([]);
    expect(stripOf("m15mdfcback", "c", SORCERY, "c")).toEqual([]);
    expect(stripOf("m15mdfcfront", "w", SORCERY, "c").map((o) => o.path)).toEqual(["/frames/m15mdfcfront/strip/c.png"]);
    expect(stripOf("m15mdfcback", "u", SORCERY, "c").map((o) => o.path)).toEqual(["/frames/m15mdfcback/strip/c.png"]);
    // STX #154 Pestilent Cauldron's shape: a colourless ARTIFACT face on `a`
    // beside a coloured one — the pieces it drew before.
    expect(stripOf("m15mdfcfront", "c", ARTIFACT, "g").map((o) => o.path)).toEqual(["/frames/m15mdfcfront/strip/g.png"]);
    expect(stripOf("m15mdfcback", "g", SORCERY, "a").map((o) => o.path)).toEqual(["/frames/m15mdfcback/strip/a.png"]);
    expect(stripOf("m15mdfcfront", "c", ARTIFACT, "a")).toEqual([]);
    // An artifact face beside a see-through one: the `c` piece over `a`.
    expect(stripOf("m15mdfcfront", "c", ARTIFACT, "c").map((o) => o.path)).toEqual(["/frames/m15mdfcfront/strip/c.png"]);
    // The land bodies map an artifact other face to their grey, as before.
    expect(stripOf("m15mdfclandfront", "g", { cardType: "land" }, "a").map((o) => o.path)).toEqual(["/frames/m15mdfclandfront/strip/c.png"]);
  });
});

describe("the import: STX #6 and PSTX #6s land on the modal bodies in `c` once the see-through `c` is ticked; STX #286 keeps its landing", () => {
  it("the mapper puts both faces on the modal bodies, colourless; the registry names the modal frame exact (no longer dfc/colourless-face)", () => {
    for (const key of ["stx-6", "pstx-6s"]) {
      expect(dfcImportOf(printing(key)), key).toMatchObject({ layout: "modal", kind: "mdfc", blocked: null, frontBody: "m15mdfcfront", backBody: "m15mdfcback" });
      expect(frameMatchFromScryfall(printing(key)).signature, key).not.toBe("dfc/colourless-face");
      const patch = mapScryfallToFormPatch(printing(key));
      expect(patch, key).toMatchObject({ kind: "mdfc", frame_template: "m15mdfcfront", card_type: "creature" });
      expect(patch.back_face, key).toMatchObject({ title: "Explore the Vastlands", card_type: "sorcery", frame_style: { template: "m15mdfcback" } });
    }
    expect(frameMatchFromScryfall(printing("stx-6"))).toMatchObject({ signature: "modal/2015", status: "exact", template: "m15mdfcfront" });
  });

  it("finalizeImportMatch: short of the see-through tick the import lands as before 5.11a (the standard frame, a legacy back) and says which face waits; with it, exact on both bodies", () => {
    for (const key of ["stx-6", "pstx-6s"]) {
      const patch = mapScryfallToFormPatch(printing(key));
      const waiting = finalizeImportMatch(patch, TICKED);
      expect(waiting, key).toMatchObject({ kind: "creature", frame_template: "m15" });
      expect(waiting.back_face?.frame_style, key).toBeUndefined();
      expect(waiting.frame_match, key).toMatchObject({ status: "nearest", unverified: true, landOn: "m15" });
      expect(waiting.frame_match?.reason, key).toMatch(/front face's see-through colourless frame/);
      expect(dfcImportLanding(patch, TICKED), key).toMatchObject({ ok: false, reason: "front-unverified", seeThrough: true });
      // Only the front's ticked: the back says it waits.
      const frontOnly = new Set([...TICKED, seeThroughColorlessKey("m15mdfcfront")]);
      expect(dfcImportLanding(patch, frontOnly), key).toMatchObject({ ok: false, reason: "back-unverified", seeThrough: true });
      expect(finalizeImportMatch(patch, frontOnly).frame_match?.reason, key).toMatch(/back face's see-through colourless frame/);
      const landed = finalizeImportMatch(patch, SEE_THROUGH);
      expect(landed, key).toMatchObject({ kind: "mdfc", frame_template: "m15mdfcfront", back_face: { frame_style: { template: "m15mdfcback" } } });
      expect(landed.frame_match, key).toMatchObject({ status: "exact" });
      expect(dfcImportLanding(patch, SEE_THROUGH), key).toMatchObject({ ok: true, kind: "mdfc", frontBody: "m15mdfcfront", backBody: "m15mdfcback" });
    }
  });

  it("STX #286, the extended-art printing, keeps the landing it had (5.7b: no see-through extended body) — the standard frame with a legacy back", () => {
    expect(dfcImportOf(printing("stx-286"))).toMatchObject({ blocked: "colourless-face", frontBody: "m15mdfcfront", backBody: "m15mdfcback" });
    expect(frameMatchFromScryfall(printing("stx-286"))).toMatchObject({ signature: "dfc/colourless-face", status: "nearest", landOn: "m15", blockedBy: "5.11" });
    const landed = finalizeImportMatch(mapScryfallToFormPatch(printing("stx-286")), SEE_THROUGH);
    expect(landed).toMatchObject({ kind: "creature", frame_template: "m15" });
    expect(landed.back_face?.frame_style).toBeUndefined();
  });

  it("EMN #63 Grizzled Angler's colourless Eldrazi back (a transform back) is still blocked: 5.11's", () => {
    expect(dfcImportOf(printing("emn-63"))).toMatchObject({ blocked: "colourless-face" });
    expect(frameMatchFromScryfall(printing("emn-63"))).toMatchObject({ signature: "dfc/colourless-face", blockedBy: "5.11" });
  });
});

describe("the AI dialog (#639): a colourless modal card once the see-through `c` is ticked", () => {
  it("the colour hints offer colourless on Modal only with both see-through keys; never on Transform", () => {
    expect(dfcSeeThroughColorlessOffered("mdfc", null, TICKED)).toBe(false);
    expect(dfcColorHints("mdfc", null, TICKED)).not.toContain("colorless");
    expect(dfcSeeThroughColorlessOffered("mdfc", null, SEE_THROUGH)).toBe(true);
    expect(dfcColorHints("mdfc", null, SEE_THROUGH)).toContain("colorless");
    const transformKeys = new Set([...SEE_THROUGH, ...keys(...(["m15dfcfront", "m15dfcback"] as const).flatMap((t) => ALL_KEYS.map((k) => [t, k] as [string, string])))]);
    expect(dfcColorHints("transform", null, transformKeys)).not.toContain("colorless");
  });

  it("the lint lets a colourless sorcery back through on Modal (the fit asks for the tick), never on Transform", () => {
    const card = {
      title: "Wandering Archaic",
      cost: "{5}",
      card_type: "creature" as const,
      supertype: null,
      subtypes: ["Avatar"],
      color_identity: ["colorless" as const],
      rules_text: "Whenever an opponent casts an instant or sorcery spell, they may pay {2}.",
      power: "4",
      toughness: "4",
      loyalty: null,
      defense: null,
      back_face: {
        title: "Explore the Vastlands",
        cost: "{3}",
        card_type: "sorcery" as const,
        supertype: null,
        subtypes: [],
        color_identity: ["colorless" as const],
        rules_text: "Each player gains 3 life.",
        flavor_text: null,
        power: null,
        toughness: null,
        art_prompt: "a vast snowy plain",
      },
    };
    const colourIssue = (kind: "mdfc" | "transform") =>
      lintDfcDesign(card as never, kind).errors.filter((e) => e.field === "color_identity" && /colorless back/i.test(e.message));
    expect(colourIssue("mdfc")).toEqual([]);
    expect(colourIssue("transform").length).toBe(1);
  });
});
