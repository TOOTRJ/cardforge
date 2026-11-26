import { describe, expect, it } from "vitest";
import printingsData from "./fixtures/dbl-double-feature-printings.json";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import { frameColorsFromScryfall, frameMatchFromScryfall, mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import { FRAME_SIGNATURE_KEYS } from "@/lib/scryfall/frame-signatures";
import { importedAnatomy, normalizeAnatomy } from "@/lib/cards/anatomy";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { pickFrameColorKey } from "@/lib/cards/frame-color-key";
import { finalizeImportMatch, remixFrameFor } from "@/lib/creator/frame-resolve";
import { frameChoicesForType, resolveGeneratedFrame } from "@/lib/creator/frame-random";
import { frameFitsImport, importFramePlan, importedKindOf } from "@/lib/creator/import-frame-choice";
import { templateRefusesKind } from "@/lib/creator/card-kinds";
import { frameRequestFromImport } from "@/lib/frames/frame-requests";
import type { FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 5.9 (its one-faced part): the Innistrad: Double Feature imports. The
// set's 437 one-faced printings and four of its transform cards
// (fixtures/dbl-double-feature-printings.json, captured from Scryfall on
// 2026-11-25 and trimmed to what the import reads — `produced_mana` kept,
// which a 2015-frame land's colour is read from): every one-faced
// creature, instant, sorcery, enchantment, artifact and land — 431 — takes
// the `double-feature/one-faced` signature and names the frame once it is
// verified in the card's colour (`doublefeature`, the land
// `doublefeatureland`) — a COLOURED artifact once `c` is verified too, the
// combo whose references show the artifact master — exact there, and until
// then nearest on the frame it always landed on. The five walkers, the one
// Vehicle (#427 Honeymoon Hearse) and the transform cards keep the old rule
// under its old key (`double-feature`): the request rows logged before this
// frame stay theirs.
// ---------------------------------------------------------------------------

const printings = printingsData as Record<string, unknown>;
const card = (key: string) => scryfallCardSchema.parse(printings[key]);
const KEYS = ["w", "u", "b", "r", "g", "c", "m"] as const;
const every = (template: FrameTemplate) => new Set(KEYS.map((k) => frameComboKey(template, k)));
const OLD_REASON = "PipGlyph doesn't have Double Feature's black-and-white frame yet";
const ONE_FACED = "double-feature/one-faced";
const isArtifact = (r: { c: { type_line?: string | null } }) => /\bArtifact\b/.test(r.c.type_line ?? "");

const rows = Object.keys(printings).map((key) => {
  const c = card(key);
  return { key, c, match: frameMatchFromScryfall(c), colour: pickFrameColorKey(frameColorsFromScryfall(c)) };
});
const oneFaced = rows.filter((r) => r.c.layout === "normal");
const isWalker = (r: (typeof rows)[number]) => /Planeswalker/.test(r.c.type_line ?? "");
const eligible = oneFaced.filter((r) => !isWalker(r) && r.c.collector_number !== "427");
const rest = rows.filter((r) => !eligible.includes(r));

describe("the Innistrad: Double Feature imports", () => {
  it("covers the set: 437 one-faced printings — 431 on the frame — and four transform cards", () => {
    expect(oneFaced).toHaveLength(437);
    expect(eligible).toHaveLength(431);
    expect(oneFaced.filter(isWalker)).toHaveLength(5);
    expect(rows.filter((r) => r.c.layout === "transform")).toHaveLength(4);
    for (const r of rows) expect([r.c.set, r.c.border_color, r.c.frame], r.key).toEqual(["dbl", "black", "2015"]);
    expect(eligible.filter((r) => /Land/.test(r.c.type_line ?? ""))).toHaveLength(14);
  });

  it("puts the one-faced rule before the old one, both before every rule that called them exact", () => {
    const at = (key: string) => FRAME_SIGNATURE_KEYS.indexOf(key);
    expect(at("double-feature")).toBe(at(ONE_FACED) + 1);
    expect(at("signature-spellbook")).toBe(at("double-feature") + 1);
    for (const later of ["transform/2015", "vehicle/2015", "era/2015"]) expect(at("double-feature"), later).toBeLessThan(at(later));
  });

  it("names the frame once verified for every one-faced card it dresses — nearest on today's landing until then", () => {
    for (const r of eligible) {
      const land = /Land/.test(r.c.type_line ?? "");
      expect(r.match, r.key).toMatchObject({
        signature: ONE_FACED,
        status: "nearest",
        onceVerified: land ? "doublefeatureland" : "doublefeature",
        onceVerifiedMatch: { status: "exact", reason: null },
        reason: "PipGlyph's Double Feature frame isn't verified yet",
        blockedBy: "5.9",
        exactLabel: "Innistrad: Double Feature black-and-white frame (one-faced)",
      });
      // Today's landing: the kind's M15 frame, as before.
      expect(["m15", "m15artifact", "m15land"], r.key).toContain(r.match.template);
    }
  });

  it("leaves the walkers, the Vehicle and the transform cards on the old rule, under its old key and label", () => {
    expect(rest).toHaveLength(10);
    for (const r of rest) {
      expect(r.match, r.key).toMatchObject({
        signature: "double-feature",
        status: "nearest",
        reason: OLD_REASON,
        exactLabel: "Innistrad: Double Feature black-and-white frame",
        // A walker waits for 5.13's walker body, the rest for 5.9's other part.
        blockedBy: isWalker(r) ? "5.13" : "5.9",
      });
      expect(r.match.onceVerified, r.key).toBeUndefined();
    }
    expect(rest.filter(isWalker)).toHaveLength(5);
    expect(frameMatchFromScryfall(card("dbl-427")).template).toBe("m15artifact");
    expect(frameMatchFromScryfall(card("dbl-2")).template).toBe("m15dfcfront");
  });

  it("is nearest until the card's colour is verified, exact once it is — and logs the ask until then", () => {
    const cases: [string, FrameTemplate, FrameTemplate][] = [
      ["dbl-1", "m15", "doublefeature"], // Adeline, white legend
      ["dbl-43", "m15", "doublefeature"], // Component Collector, blue
      ["dbl-216", "m15", "doublefeature"], // Dawnhart Wardens, G/W: gold
      ["dbl-252", "m15artifact", "doublefeature"], // The Celestus, colourless
      ["dbl-261", "m15land", "doublefeatureland"], // Evolving Wilds
      ["dbl-266", "m15land", "doublefeatureland"], // Rockfall Vale, R/G
      ["dbl-534", "m15land", "doublefeatureland"], // Voldaren Estate: taps for any colour, gold
    ];
    for (const [key, landing, frame] of cases) {
      const raw = mapScryfallToFormPatch(card(key));
      const colour = pickFrameColorKey(raw.color_identity ?? []);
      const standards = new Set([...every("m15"), ...every("m15artifact"), ...every("m15land")]);
      const none = finalizeImportMatch(raw, standards);
      expect([none.frame_template, none.frame_match?.status], key).toEqual([landing, "nearest"]);
      expect(frameRequestFromImport(none, { artImported: true, source: "import", verifiedKeys: standards }), key).toMatchObject({ signature: ONE_FACED, status: "nearest", template: landing });
      // Another colour ticked is not this one.
      const other = finalizeImportMatch(raw, new Set([...standards, frameComboKey(frame, colour === "w" ? "u" : "w")]));
      expect(other.frame_template, key).toBe(landing);
      const ticked = new Set([...standards, frameComboKey(frame, colour)]);
      const exact = finalizeImportMatch(raw, ticked);
      expect([exact.frame_template, exact.frame_match?.status], key).toEqual([frame, "exact"]);
      expect(frameRequestFromImport(exact, { artImported: true, source: "import", verifiedKeys: ticked }), key).toBeNull();
    }
  });

  it("reads a land's colour from the mana it makes: Voldaren Estate (colourless identity, any colour) is the gold land", () => {
    const raw = mapScryfallToFormPatch(card("dbl-534"));
    expect(raw.color_identity).toEqual(["multicolor"]);
    const ticked = new Set([...every("m15land"), frameComboKey("doublefeatureland", "m")]);
    const exact = finalizeImportMatch(raw, ticked);
    expect([exact.frame_template, exact.frame_match?.status, pickFrameColorKey(exact.color_identity ?? [])]).toEqual([
      "doublefeatureland",
      "exact",
      "m",
    ]);
    // The grey stone is the colourless lands' alone.
    expect(finalizeImportMatch(raw, new Set([...every("m15land"), frameComboKey("doublefeatureland", "c")])).frame_template).toBe("m15land");
    for (const key of ["dbl-261", "dbl-262"]) {
      expect(mapScryfallToFormPatch(card(key)).color_identity, key).toEqual(["colorless"]);
    }
  });

  it("a COLOURED artifact needs its colour AND `c` (the combo whose references show the artifact master)", () => {
    const standards = new Set([...every("m15"), ...every("m15artifact"), ...every("m15land")]);
    const coloured = eligible.filter((r) => isArtifact(r) && r.colour !== "c");
    // DBL's coloured artifacts: w #23 / #271, b #111 / #362 / #384, r #142 / #444, g #171 / #455 / #487.
    expect(coloured.map((r) => r.key).sort()).toEqual(
      ["dbl-111", "dbl-142", "dbl-171", "dbl-23", "dbl-271", "dbl-362", "dbl-384", "dbl-444", "dbl-455", "dbl-487"].sort(),
    );
    for (const r of coloured) {
      const raw = mapScryfallToFormPatch(r.c);
      const ownOnly = new Set([...standards, frameComboKey("doublefeature", r.colour)]);
      const nearest = finalizeImportMatch(raw, ownOnly);
      expect([nearest.frame_template, nearest.frame_match?.status], r.key).toEqual(["m15artifact", "nearest"]);
      expect(frameRequestFromImport(nearest, { artImported: true, source: "import", verifiedKeys: ownOnly }), r.key).toMatchObject({ signature: ONE_FACED, cause: "unverified" });
      // `c` alone publishes the colourless artifacts, never a white one.
      expect(finalizeImportMatch(raw, new Set([...standards, frameComboKey("doublefeature", "c")])).frame_template, r.key).toBe("m15artifact");
      const both = new Set([...ownOnly, frameComboKey("doublefeature", "c")]);
      const exact = finalizeImportMatch(raw, both);
      expect([exact.frame_template, exact.frame_match?.status], r.key).toEqual(["doublefeature", "exact"]);
    }
    // A non-artifact of the same colour needs its colour alone; a colourless artifact `c` alone.
    expect(finalizeImportMatch(mapScryfallToFormPatch(card("dbl-1")), new Set([...standards, frameComboKey("doublefeature", "w")])).frame_template).toBe("doublefeature");
    expect(finalizeImportMatch(mapScryfallToFormPatch(card("dbl-252")), new Set([...standards, frameComboKey("doublefeature", "c")])).frame_template).toBe("doublefeature");
  });

  it("keeps the printing's colour; a legend's crown on, a rare's oval stamp, a dual's split pinline", () => {
    let duals = 0;
    for (const r of eligible) {
      const land = /Land/.test(r.c.type_line ?? "");
      const template: FrameTemplate = land ? "doublefeatureland" : "doublefeature";
      const patch = mapScryfallToFormPatch(r.c);
      const { style } = importedAnatomy(patch, template);
      const saved = normalizeAnatomy({ ...style, template }, template, patch.card_type ?? "creature");
      expect(saved.crown === true, r.key).toBe(!land && (r.c.frame_effects ?? []).includes("legendary"));
      expect(saved.stamp === "oval" || saved.stamp === "auto", r.key).toBe(r.c.security_stamp === "oval");
      const dual = land && (r.c.color_identity ?? []).length === 2;
      if (dual) duals += 1;
      expect(saved.twoColor === true, r.key).toBe(dual);
    }
    expect(duals).toBe(10);
  });

  it("the frames dress the kinds the rule keeps to, the land frame the land alone", () => {
    for (const kind of ["creature", "instant", "sorcery", "enchantment", "artifact"] as const) expect(templateRefusesKind("doublefeature", kind), kind).toBe(false);
    for (const kind of ["land", "planeswalker", "battle", "token", "saga"] as const) expect(templateRefusesKind("doublefeature", kind), kind).toBe(true);
    expect(templateRefusesKind("doublefeatureland", "land")).toBe(false);
    for (const kind of ["creature", "instant", "artifact", "planeswalker"] as const) expect(templateRefusesKind("doublefeatureland", kind), kind).toBe(true);
  });

  it("the AI's random pool reaches the frame only once it is verified in the card's colour", () => {
    const pool = (verified: ReadonlySet<string>) => {
      const picks = new Set<string | null>();
      for (let i = 0; i < 400; i += 1) {
        picks.add(resolveGeneratedFrame({ cardType: "creature", requested: "random", colorIdentity: ["blue"], verifiedKeys: verified, random: () => i / 400 }));
      }
      return picks;
    };
    const m15 = every("m15");
    expect(pool(m15).has("doublefeature")).toBe(false);
    expect(pool(new Set([...m15, frameComboKey("doublefeature", "w")])).has("doublefeature")).toBe(false);
    expect(pool(new Set([...m15, frameComboKey("doublefeature", "u")])).has("doublefeature")).toBe(true);
    const offered = (verified: ReadonlySet<string>) => frameChoicesForType("creature", verified).find((f) => f.template === "doublefeature");
    expect(offered(m15)?.availableColorKeys ?? []).toEqual([]);
    expect(offered(every("doublefeature"))?.availableColorKeys).toEqual(expect.arrayContaining([...KEYS]));
    // A land asked for by name lands on the land frame's family, never the
    // spell frame.
    expect(resolveGeneratedFrame({ cardType: "land", requested: "doublefeature", colorIdentity: ["blue"], verifiedKeys: new Set([...every("doublefeature"), ...every("m15land")]), random: () => 0 })).not.toBe("doublefeature");
  });

  it("the AI reaches it for a COLOURED artifact only once `c` is verified too — at random, by name, and an Artifact Creature as well", () => {
    const whiteOnly = new Set([...every("m15artifact"), ...every("m15"), frameComboKey("doublefeature", "w")]);
    const withC = new Set([...whiteOnly, frameComboKey("doublefeature", "c")]);
    const pool = (cardType: "artifact" | "creature", supertype: string | undefined, verified: ReadonlySet<string>) => {
      const picks = new Set<string | null>();
      for (let i = 0; i < 400; i += 1) {
        picks.add(resolveGeneratedFrame({ cardType, requested: "random", colorIdentity: ["white"], verifiedKeys: verified, face: { cardType, supertype }, random: () => i / 400 }));
      }
      return picks;
    };
    expect(pool("artifact", undefined, whiteOnly).has("doublefeature")).toBe(false);
    expect(pool("artifact", undefined, withC).has("doublefeature")).toBe(true);
    expect(pool("creature", "Artifact", whiteOnly).has("doublefeature")).toBe(false);
    expect(pool("creature", "Artifact", withC).has("doublefeature")).toBe(true);
    // …and a plain white creature needs white alone.
    expect(pool("creature", undefined, whiteOnly).has("doublefeature")).toBe(true);
    const named = (verified: ReadonlySet<string>) =>
      resolveGeneratedFrame({ cardType: "artifact", requested: "doublefeature", colorIdentity: ["white"], verifiedKeys: verified, random: () => 0 });
    expect(named(whiteOnly)).not.toBe("doublefeature");
    expect(named(withC)).toBe("doublefeature");
    // The frame-first dialog's colours for an artifact on the frame.
    const offered = (verified: ReadonlySet<string>) => frameChoicesForType("artifact", verified).find((f) => f.template === "doublefeature")?.availableColorKeys ?? [];
    expect(offered(whiteOnly)).toEqual([]);
    expect([...offered(withC)].sort()).toEqual(["c", "w"]);
  });

  it("the import chooser and the remix landing read the same rule", () => {
    const standards = new Set([...every("m15"), ...every("m15artifact"), ...every("m15land")]);
    const whiteOnly = new Set([...standards, frameComboKey("doublefeature", "w")]);
    const withC = new Set([...whiteOnly, frameComboKey("doublefeature", "c")]);
    const mask = mapScryfallToFormPatch(card("dbl-23")); // Hedgewitch's Mask, white
    const witch = mapScryfallToFormPatch(card("dbl-8")); // Candlegrove Witch, white creature
    const fits = (patch: typeof mask, verified: ReadonlySet<string>) =>
      frameFitsImport("doublefeature", { kind: importedKindOf(patch)!, verifiedKeys: verified, patch });
    expect(fits(mask, whiteOnly)).toBe(false);
    expect(fits(mask, withC)).toBe(true);
    expect(fits(witch, whiteOnly)).toBe(true);
    const offeredIn = (patch: typeof mask, verified: ReadonlySet<string>) => {
      const plan = importFramePlan(finalizeImportMatch(patch, verified), verified, "m15artifact");
      return plan.mode === "choose" ? [...plan.options, ...plan.moreOptions].map((o) => o.template) : [];
    };
    expect(offeredIn(mask, whiteOnly)).not.toContain("doublefeature");
    // The remix of the printing lands where the import does.
    expect(remixFrameFor(finalizeImportMatch(mask, whiteOnly), whiteOnly)).toMatchObject({ ok: true, template: "m15artifact" });
    expect(remixFrameFor(mask, withC)).toMatchObject({ ok: true, template: "doublefeature" });
    // #111 Mask of Griselbrand (black, legendary): exact with the `a` crown only once `c` is ticked.
    const griselbrand = mapScryfallToFormPatch(card("dbl-111"));
    const blackOnly = new Set([...standards, frameComboKey("doublefeature", "b")]);
    expect(finalizeImportMatch(griselbrand, blackOnly).frame_template).toBe("m15artifact");
    expect(finalizeImportMatch(griselbrand, new Set([...blackOnly, frameComboKey("doublefeature", "c")])).frame_match?.status).toBe("exact");
  });
});
