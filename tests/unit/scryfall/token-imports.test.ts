import { describe, expect, it } from "vitest";
import tokenData from "./fixtures/token-printings.json";
import plstData from "./fixtures/plst-token-prefixes.json";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import {
  droppedFaceNotice,
  frameMatchFromScryfall,
  kindFromScryfall,
  mapScryfallToFormPatch,
  printingTreatmentFromScryfall,
} from "@/lib/scryfall/import-mapper";
import {
  M20_TOKEN_DESIGN_FROM,
  PLST_PRE_M20_PREFIX_SETS,
  TALL_BOX_TOKEN_PINS,
  isM20DesignPrinting,
  type FrameMatchStatus,
} from "@/lib/scryfall/frame-signatures";
import { onlyUndrawnDetailsMissing } from "@/lib/creator/import-frame-choice";
import { finalizeImportMatch, withVerification } from "@/lib/creator/frame-resolve";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { frameRequestFromImport } from "@/lib/frames/frame-requests";
import type { FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 1.23: token (and emblem) imports land on the right design and kind.
// Every fixture is a real printing captured once from Scryfall
// (/cards/collection, 2026-09-29) and trimmed to the fields the registry and
// the importer read (tests/unit/scryfall/fixtures/token-printings.json);
// the List prefixes come from tests/unit/scryfall/fixtures/
// plst-token-prefixes.json. Tests never call Scryfall.
// ---------------------------------------------------------------------------

type Key = keyof typeof tokenData;
const printing = (key: Key) => scryfallCardSchema.parse(tokenData[key]);
const match = (key: Key) => frameMatchFromScryfall(printing(key));

// [fixture, status, template, signature, blockedBy]
type Row = [Key, FrameMatchStatus, FrameTemplate, string, string | undefined];

describe("token designs by printing (TODO 1.23, replaces 1.19 step 4)", () => {
  const rows: Row[] = [
    // The 2014–19 arch (M15 → MH1) IS m15token / m15tokenartifact: exact —
    // and m15tokentext / m15tokenartifacttext when the printing has rules or
    // flavour text (4.49 (b): TDOM #2, TXLN #7).
    ["tdom-3", "exact", "m15token", "era/2015", undefined],
    ["tdom-2", "exact", "m15tokentext", "era/2015", undefined],
    ["tdom-11", "exact", "m15token", "era/2015", undefined],
    ["txln-7", "exact", "m15tokenartifacttext", "era/2015", undefined],
    // …except the arch's TALL text box (4.55, P3 — split out of 4.49 (b),
    // owner 2026-09-29; no CC source): pinned (TALL_BOX_TOKEN_PINS),
    // nearest the regular box and logged, blocked by its own item.
    ["takh-1", "nearest", "m15tokentext", "era/2015+tall-box", "4.55"],
    ["tsoi-11", "nearest", "m15tokenartifacttext", "era/2015+tall-box", "4.55"],
    // From M20 (2019-07-12) on: the full-art design PipGlyph doesn't draw
    // yet (4.48) — nearest the arch, the artifact arch for an Artifact, and
    // its text-box variant when the printing has text (4.49 (b): a box, not
    // the scrim). TM20 #2 and T2XM #4 were `exact` on m15token before.
    ["tm20-2", "nearest", "m15token", "token/m20", "4.48"],
    ["t2xm-4", "nearest", "m15token", "token/m20", "4.48"],
    ["tfdn-6", "nearest", "m15token", "token/m20", "4.48"],
    ["tfdn-27", "nearest", "m15tokentext", "token/m20", "4.48"],
    ["tblb-5", "nearest", "m15tokentext", "token/m20", "4.48"],
    ["tlci-17", "nearest", "m15tokenartifacttext", "token/m20", "4.48"],
    ["tfdn-23", "nearest", "m15tokenartifacttext", "token/m20", "4.48"],
    ["tdsk-7", "nearest", "m15tokenartifact", "token/m20", "4.48"],
    // A plain enchantment token (no Nyx) and a Copy.
    ["tkhm-1", "nearest", "m15tokentext", "token/m20", "4.48"],
    ["tfdn-26", "nearest", "m15tokentext", "token/m20", "4.48"],
    ["t2xm-31", "nearest", "m15tokentext", "token/m20", "4.48"],
    // Nyx on the token kind names 4.51 (not 4.7's non-token m15nyx):
    // flagged by Scryfall (TEOC #13) or pinned (TDSK #4, TDSK #10).
    ["teoc-13", "nearest", "m15tokenartifact", "token/m20+nyx-dress", "4.51"],
    ["tdsk-4", "nearest", "m15token", "token/m20+nyx-dress", "4.51"],
    ["tdsk-10", "nearest", "m15token", "token/m20+nyx-dress", "4.51"],
    // …and on the 2014–19 arch (TC15 #23, a W/B Nyx-textured Spirit).
    ["tc15-23", "nearest", "m15tokentext", "era/2015+nyx-dress", "4.51"],
    // The crown and the two-colour blend: the M20 token's own pill crown and
    // its central rim split are 4.48 (design 2026-09-29 hand-offs; 4.6a's
    // band and 4.6b's pair masters are never a token's).
    ["tmkm-13", "nearest", "m15tokentext", "token/m20+crown", "4.48"],
    ["tmkm-10", "nearest", "m15token", "token/m20+two-colour", "4.48"],
    // Double-faced token: its front face's frame.
    ["tmom-16", "nearest", "m15tokenartifacttext", "token/m20", "4.48"],
    // The List follows its collector prefix: TXLN is pre-M20, TKHM isn't.
    ["plst-txln-10", "exact", "m15tokenartifacttext", "era/2015", undefined],
    ["plst-tkhm-19", "nearest", "m15tokenartifacttext", "token/m20", "4.48"],
    // Other token types: nearest on the token kind, logged (1.6).
    ["tfra-5", "nearest", "m15tokentext", "token/other-type", undefined],
    ["tdsk-16", "nearest", "m15tokentext", "token/other-type", undefined],
    ["tbro-3", "nearest", "m15tokentext", "token/other-type", undefined],
    // Roles: the front Role, logged unsupported.
    ["twoe-15", "unsupported", "m15tokentext", "token/role", undefined],
    ["twoc-1", "unsupported", "m15tokentext", "token/role", undefined],
    ["plst-twoe-17", "unsupported", "m15tokentext", "token/role", undefined],
    // A 2003-frame token: 1.4's token/old-frame, unchanged.
    ["tlrw-3", "nearest", "m15token", "token/old-frame", "4.43"],
  ];

  it.each(rows)("%s → %s %s (%s, blockedBy %s)", (key, status, template, signature, blockedBy) => {
    const m = match(key);
    expect([m.status, m.template, m.signature, m.blockedBy, m.landOn]).toEqual([
      status,
      template,
      signature,
      blockedBy,
      undefined,
    ]);
    expect(m.reason === null).toBe(status === "exact");
  });

  it("says why an M20 token isn't exact, and keeps saying it beside a gap", () => {
    expect(match("t2xm-4")).toMatchObject({
      exactLabel: "M20 full-art token frame",
      reason: "PipGlyph's full-art token frame isn't verified yet",
    });
    expect(match("tmkm-13").reason).toBe(
      "PipGlyph's full-art token frame isn't verified yet; PipGlyph doesn't draw the legendary crown on this frame yet",
    );
    expect(match("tdsk-4").reason).toBe(
      "PipGlyph's full-art token frame isn't verified yet; PipGlyph doesn't draw the Nyx dress on its token frames yet",
    );
    expect(match("tfra-5")).toMatchObject({
      exactLabel: "Planeswalker token",
      reason: "PipGlyph's token frames don't print a planeswalker token's loyalty yet",
    });
    expect(match("tbro-3").exactLabel).toBe("Land token");
  });

  it("records no anatomy gaps on the M20 design, so the chooser always asks (C1 stays for exact bases)", () => {
    for (const key of ["tmkm-13", "tmkm-10", "tdsk-4"] as const) {
      const m = match(key);
      expect(m.gaps, key).toBeUndefined();
      expect(onlyUndrawnDetailsMissing(m, "m"), key).toBe(false);
    }
    // The 2014–19 arch is the printing's own frame: its gaps are listed.
    expect(match("tc15-23").gaps).toEqual(["nyx-dress", "two-colour"]);
  });

  it("names the token rules' items in the request log (signatureBlockedBy reads the rule)", () => {
    const patch = mapScryfallToFormPatch(printing("tdsk-4"));
    expect(
      frameRequestFromImport(patch, { artImported: false, source: "import" }),
    ).toMatchObject({ signature: "token/m20+nyx-dress", status: "nearest", template: "m15token" });
    const role = mapScryfallToFormPatch(printing("twoe-15"));
    expect(frameRequestFromImport(role, { artImported: false, source: "import" })).toMatchObject({
      signature: "token/role",
      status: "unsupported",
      setCode: "twoe",
      collectorNumber: "15",
    });
  });
});

// TODO 4.48 / 4.50: the full-art templates exist, and 1.23's token/m20 rule
// names them through `onceVerified` — the height from the printing's text
// (lib/cards/token-height.ts: Scryfall has no field for it), the artifact
// template for an Artifact — and is EXACT on them once they are verified in
// the card's colour (`onceVerifiedMatch`); a gap they don't draw either (the
// crown, two colours, the Nyx dress) stays nearest with its own reason and
// item, and its gaps (C1: it is the printing's own frame by then).
describe("the full-art templates once verified (TODO 4.48 / 1.23)", () => {
  const once: [Key, FrameTemplate][] = [
    // The first year and today's textless prints.
    ["tm20-2", "m20token"],
    ["t2xm-4", "m20token"],
    ["tfdn-6", "m20token"],
    // The regular box (a Copy, a plain enchantment Shard, a Treasure)…
    ["tfdn-27", "m20tokentext"],
    ["tfdn-26", "m20tokentext"],
    ["t2xm-31", "m20tokentext"],
    ["tkhm-1", "m20tokentext"],
    ["tfdn-23", "m20tokenartifacttext"],
    ["tfra-15", "m20tokenartifacttext"],
    ["plst-tkhm-19", "m20tokenartifacttext"],
    ["tmom-16", "m20tokenartifacttext"],
    // …the tall box (Warren Warleader's 207 characters, the Map's 287)…
    ["tblb-5", "m20tokentall"],
    ["tlci-17", "m20tokenartifacttall"],
    // …and a coloured artifact on the artifact template (TDSK #7 Toy).
    ["tdsk-7", "m20tokenartifact"],
  ];

  it.each(once)("%s names %s, and is exact on it once it is verified in its colour", (key, template) => {
    const m = match(key);
    expect(m.onceVerified).toBe(template);
    expect(m.onceVerifiedMatch).toEqual({ status: "exact", reason: null });
    // Unverified: the arch stands in, as before, and the answer says what's
    // left — "not yet verified", the request log's "Not yet verified" (D1).
    const colour = pickColour(key);
    const waiting = withVerification(m, colour, new Set());
    expect(waiting).toMatchObject({ status: "nearest", unverified: true, reason: expect.stringMatching(/^not yet verified in /) });
    expect(waiting.template).toBe(m.template);
    expect(waiting.template).toMatch(/^m15token/);
    expect(waiting.blockedBy).toBeUndefined();
    // Verified: exact on the full-art template, no reason, no item.
    const done = withVerification(m, colour, new Set([frameComboKey(template, colour)]));
    expect(done).toMatchObject({ status: "exact", template, reason: null });
    expect(done.blockedBy).toBeUndefined();
    expect(done.gaps).toBeUndefined();
    expect(done.onceVerified).toBeUndefined();
  });

  it("keeps a gap the full-art template doesn't draw either: nearest, its own reason, item and gaps", () => {
    const cases: [Key, FrameTemplate, string, string, string[]][] = [
      // The M20 token's crown and pair are 4.48's (its pill crown, the rims'
      // central split), not 4.6's M15 pieces.
      ["tmkm-13", "m20tokentext", "PipGlyph doesn't draw the legendary crown on this frame yet", "4.48", ["crown", "two-colour"]],
      ["tmkm-10", "m20token", "two-colour cards print a split frame, and PipGlyph uses its gold one", "4.48", ["two-colour"]],
      ["tdsk-4", "m20token", "PipGlyph doesn't draw the Nyx dress on its token frames yet", "4.51", ["nyx-dress"]],
      ["teoc-13", "m20tokenartifact", "PipGlyph doesn't draw the Nyx dress on its token frames yet", "4.51", ["nyx-dress"]],
    ];
    for (const [key, template, reason, blockedBy, gaps] of cases) {
      const m = match(key);
      expect(m.onceVerified, key).toBe(template);
      // Before its tick: still the registry's own nearest (a gap is missing
      // whatever is verified), never "not yet verified".
      expect(withVerification(m, pickColour(key), new Set()).unverified, key).toBeUndefined();
      // Two colours land on gold ("m") until 4.6's gradient.
      const colour = pickColour(key);
      const done = withVerification(m, colour, new Set([frameComboKey(template, colour)]));
      expect(done, key).toMatchObject({ status: "nearest", template, reason, blockedBy, gaps });
    }
    expect(pickColour("tmkm-10")).toBe("m");
  });

  it("finalizes an import patch onto the full-art template once verified (the form's frame follows)", () => {
    const patch = mapScryfallToFormPatch(printing("tfdn-27"));
    expect(patch.frame_template).toBe("m15tokentext");
    const done = finalizeImportMatch(patch, new Set([frameComboKey("m20tokentext", "w")]));
    expect(done.frame_template).toBe("m20tokentext");
    expect(done.frame_match).toMatchObject({ status: "exact", template: "m20tokentext" });
    // Verified in another colour only: nothing moves.
    const other = finalizeImportMatch(patch, new Set([frameComboKey("m20tokentext", "u")]));
    expect(other.frame_template).toBe("m15tokentext");
  });

  it("never names a full-art template for a 2014–19 token, an old-frame token, a Role or another token type", () => {
    for (const key of ["tdom-3", "tdom-2", "txln-7", "takh-1", "tc15-23", "plst-txln-10", "tlrw-3", "twoe-15", "tfra-5", "tbro-3"] as Key[]) {
      expect(match(key).onceVerified, key).toBeUndefined();
      expect(match(key).onceVerifiedMatch, key).toBeUndefined();
    }
  });
});

/** The frame colour key a fixture verifies in (pickFrameColorKey's rule). */
function pickColour(key: Key): string {
  const colors = (printing(key).card_faces?.[0]?.colors ?? printing(key).colors ?? []) as string[];
  if (colors.length === 0) return "c";
  if (colors.length > 1) return "m";
  return colors[0]!.toLowerCase();
}

describe("the 2014–19 arch's tall text box (TODO 4.49 (b), P3)", () => {
  it("pins the 21 tall-box printings — never a regular-box one, never an M20 print", () => {
    const pins = Object.entries(TALL_BOX_TOKEN_PINS).flatMap(([set, numbers]) => numbers.map((n) => `${set} #${n}`));
    expect(pins).toHaveLength(21);
    expect(new Set(pins).size).toBe(21);
    // Amonkhet / Hour of Devastation's embalmed and eternalized cards, the
    // SOI Clues (39 characters, yet tall), Dominaria's Demon, C18's Dragon
    // Egg, Mask and Clue, Rivals' Elemental, Unstable's Clue.
    expect(TALL_BOX_TOKEN_PINS.tsoi).toEqual(["11", "12", "13", "14", "15", "16"]);
    // The regular-box references and ruler prints are not pinned.
    for (const key of ["tdom-2", "txln-7", "tdom-3"] as const) {
      const card = printing(key);
      expect(TALL_BOX_TOKEN_PINS[card.set!]?.includes(card.collector_number!) ?? false, key).toBe(false);
    }
    // Every pinned set is a pre-M20 token set.
    for (const set of Object.keys(TALL_BOX_TOKEN_PINS)) expect(set, set).toMatch(/^t[a-z0-9]+$/);
  });

  it("says why, lists the gap, and logs the demand as a missing frame (1.6)", () => {
    expect(match("tsoi-11")).toMatchObject({
      status: "nearest",
      template: "m15tokenartifacttext",
      reason: "PipGlyph doesn't have the tall text box of this token frame yet",
      gaps: ["tall-box"],
    });
    // Nearest whatever is verified: never an exact match on the regular box.
    expect(match("takh-1").status).toBe("nearest");
    const patch = mapScryfallToFormPatch(printing("tsoi-11"));
    expect(frameRequestFromImport(patch, { artImported: false, source: "import" })).toMatchObject({
      signature: "era/2015+tall-box",
      status: "nearest",
      cause: "missing",
      setCode: "tsoi",
      collectorNumber: "11",
    });
    // A tall box is no detail the chooser may skip (C1).
    expect(onlyUndrawnDetailsMissing(match("takh-1"), "w")).toBe(false);
  });
});

describe("the M20 design rule (isM20DesignPrinting)", () => {
  it("starts on M20's release day", () => {
    expect(M20_TOKEN_DESIGN_FROM).toBe("2019-07-12");
    expect(isM20DesignPrinting(printing("tm20-2"))).toBe(true);
    expect(printing("tm20-2").released_at).toBe("2019-07-12");
    expect(isM20DesignPrinting({ ...printing("tm20-2"), released_at: "2019-07-11" })).toBe(false);
    expect(isM20DesignPrinting(printing("tdom-3"))).toBe(false);
    // No release date (an older cached payload) keeps the old answer.
    expect(isM20DesignPrinting({ ...printing("t2xm-4"), released_at: undefined })).toBe(false);
  });

  it("reads a List reprint by its collector prefix, not The List's date", () => {
    expect(printing("plst-txln-10").released_at! >= M20_TOKEN_DESIGN_FROM).toBe(true);
    expect(isM20DesignPrinting(printing("plst-txln-10"))).toBe(false);
    expect(isM20DesignPrinting(printing("plst-tkhm-19"))).toBe(true);
    expect(isM20DesignPrinting(printing("plst-tori-14"))).toBe(false);
    expect(isM20DesignPrinting(printing("plst-tstx-8"))).toBe(true);
  });

  it("pins exactly the List's pre-M20 prefix sets, against Scryfall's release dates", () => {
    const released = plstData.prefix_set_released_at as Record<string, string>;
    const prefixes = plstData.printings.map((p) => p.collector_number.split("-")[0]!.toLowerCase());
    // Every prefix has its set's date in the fixture.
    for (const prefix of prefixes) expect(released[prefix], prefix).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const preM20 = [...new Set(prefixes.filter((p) => released[p]! < M20_TOKEN_DESIGN_FROM))].sort();
    expect(preM20).toEqual([...PLST_PRE_M20_PREFIX_SETS].sort());
    expect(preM20).toHaveLength(11);
    // 22 of The List's 71 token and emblem printings.
    expect(plstData.printings).toHaveLength(71);
    expect(prefixes.filter((p) => PLST_PRE_M20_PREFIX_SETS.has(p))).toHaveLength(22);
    // The rule answers every List printing by its prefix's date.
    for (const p of plstData.printings) {
      const prefix = p.collector_number.split("-")[0]!.toLowerCase();
      const card = { set: "plst", collector_number: p.collector_number, released_at: "2026-05-18" };
      expect(isM20DesignPrinting(card), p.collector_number).toBe(released[prefix]! >= M20_TOKEN_DESIGN_FROM);
    }
  });
});

describe("token import words and faces (TODO 1.23)", () => {
  it("'Token Creature — Soldier' keeps the token card type with Creature in front (1.3), on either design", () => {
    expect(mapScryfallToFormPatch(printing("tdom-3"))).toMatchObject({
      kind: "token",
      card_type: "token",
      supertype: "Creature",
      subtypes_text: "Soldier",
      frame_template: "m15token",
      frame_match: { status: "exact", signature: "era/2015" },
    });
    expect(mapScryfallToFormPatch(printing("tfdn-6"))).toMatchObject({
      kind: "token",
      card_type: "token",
      supertype: "Creature",
      subtypes_text: "Soldier",
      frame_template: "m15token",
      frame_match: { status: "nearest", signature: "token/m20" },
    });
    expect(mapScryfallToFormPatch(printing("tmkm-13")).supertype).toBe("Legendary Creature");
    expect(mapScryfallToFormPatch(printing("teoc-13")).supertype).toBe("Enchantment Artifact Creature");
  });

  it("a Copy token imports as the token kind with no type words", () => {
    const patch = mapScryfallToFormPatch(printing("tfdn-26"));
    expect(patch).toMatchObject({ title: "Copy", kind: "token", card_type: "token", color_identity: ["colorless"] });
    expect(patch.supertype).toBeUndefined();
    expect(patch.subtypes_text).toBeUndefined();
    // …on 4.48's colourless design, which PipGlyph doesn't draw yet: its
    // italic line asks for the text-box arch (4.49 (b)).
    expect(patch.frame_template).toBe("m15tokentext");
    expect(patch.frame_match).toMatchObject({ status: "nearest", signature: "token/m20" });
  });

  it("other token types import on the token kind, their words kept, nearest and logged", () => {
    expect(mapScryfallToFormPatch(printing("tfra-5"))).toMatchObject({
      kind: "token",
      card_type: "token",
      supertype: "Planeswalker",
      subtypes_text: "Jace",
      frame_match: { status: "nearest", signature: "token/other-type" },
    });
    expect(mapScryfallToFormPatch(printing("tdsk-16"))).toMatchObject({
      kind: "token",
      supertype: "Land",
      frame_match: { signature: "token/other-type" },
    });
    expect(mapScryfallToFormPatch(printing("tbro-3"))).toMatchObject({
      kind: "token",
      supertype: "Land Creature",
      subtypes_text: "Forest, Dryad",
      frame_match: { signature: "token/other-type" },
    });
    expect(
      frameRequestFromImport(mapScryfallToFormPatch(printing("tfra-5")), { artImported: false, source: "import" }),
    ).toMatchObject({ signature: "token/other-type", status: "nearest" });
  });

  it("a double-faced token imports its front face only, and says so (a single-faced one drops nothing)", () => {
    const single = mapScryfallToFormPatch(printing("tdom-3"));
    expect(single.dropped_face).toBeUndefined();
    expect(droppedFaceNotice(single, "Soldier")).toBeNull();
    const card = printing("tmom-16");
    const patch = mapScryfallToFormPatch(card);
    expect(patch).toMatchObject({
      title: "Incubator",
      kind: "token",
      card_type: "token",
      supertype: "Artifact",
      subtypes_text: "Incubator",
      dropped_face: "double-faced-token",
    });
    expect(patch.back_face).toBeUndefined();
    expect(droppedFaceNotice(patch, card.name)).toBe(
      "Incubator // Phyrexian is a double-faced token — PipGlyph imported its front face, Incubator. Two-sided tokens aren't supported yet.",
    );
  });

  it("a Role card imports the front Role on the token kind (the owner's override of B2)", () => {
    const card = printing("twoe-15");
    expect(kindFromScryfall(card)).toBe("token");
    const patch = mapScryfallToFormPatch(card);
    expect(patch).toMatchObject({
      title: "Monster",
      kind: "token",
      card_type: "token",
      supertype: "Enchantment",
      subtypes_text: "Aura, Role",
      rules_text: "Enchant creature\nEnchanted creature gets +1/+1 and has trample.",
      dropped_face: "role",
    });
    expect(patch.back_face).toBeUndefined();
    expect(droppedFaceNotice(patch, card.name)).toBe(
      "Monster // Sorcerer holds two Roles — PipGlyph imported the front one, Monster.",
    );
    expect(kindFromScryfall(printing("plst-twoe-17"))).toBe("token");
  });
});

describe("the toast exception goes for M20+ tokens (TODO 1.23)", () => {
  it("names a full-art M20 token like any other nearest; a plain one has no treatment", () => {
    expect(printingTreatmentFromScryfall(printing("tm20-2"))).toBe("fullart");
    expect(printingTreatmentFromScryfall(printing("t2xm-4"))).toBe("fullart");
    expect(printingTreatmentFromScryfall(printing("tfdn-27"))).toBeUndefined();
    expect(printingTreatmentFromScryfall(printing("tdom-3"))).toBeUndefined();
  });
});

describe("emblems import on the emblem kind and read the tokens' design rule (6.23 / 4.52)", () => {
  // [fixture, M20 design, signature]: "Emblem" from M20 on (TFDN #24/#25,
  // TAFR #16, plst TSTX-8 — STX 2021) is 4.52's frame; the 2014–19 look
  // (TM15 #13, plst TORI-14) and the 2003 plaque (TDKA #3) before it are
  // nearest. Every printed emblem: tests/unit/scryfall/emblem-imports.test.ts.
  const emblems: Array<[Key, boolean, string]> = [
    ["tfdn-24", true, "emblem/m20"],
    ["tfdn-25", true, "emblem/m20"],
    ["tafr-16", true, "emblem/m20"],
    ["plst-tstx-8", true, "emblem/m20"],
    ["tm15-13", false, "emblem/2014-19"],
    ["plst-tori-14", false, "emblem/2014-19"],
    ["tdka-3", false, "emblem/old-frame"],
  ];

  it.each(emblems)("%s: the emblem kind on the emblem frame; M20 design %s (%s)", (key, m20, signature) => {
    expect(kindFromScryfall(printing(key))).toBe("emblem");
    expect(match(key)).toMatchObject({ status: m20 ? "exact" : "nearest", template: "emblem", signature });
    expect(isM20DesignPrinting(printing(key))).toBe(m20);
  });
});
