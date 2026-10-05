import { describe, expect, it } from "vitest";
import dfcPrintings from "./fixtures/dfc-import-printings.json";
import importPrintings from "./fixtures/import-printings.json";
import signaturePrintings from "./fixtures/signature-printings.json";
import { scryfallCardSchema, type ScryfallCard } from "@/lib/scryfall/client";
import {
  backFrameColorsFromScryfall,
  dfcImportOf,
  droppedFaceNotice,
  droppedFaceOf,
  frameMatchFromScryfall,
  frameTemplateFromScryfall,
  kindFromScryfall,
  mapScryfallToFormPatch,
  verifiedFrameMatchFromScryfall,
} from "@/lib/scryfall/import-mapper";
import { dfcImportLanding, isDfcImportPatch, withoutDfcLanding, DFC_REMIX_CREDITS } from "@/lib/scryfall/dfc-import";
import { finalizeImportMatch, remixFrameFor } from "@/lib/creator/frame-resolve";
import { frameRequestFromImport } from "@/lib/frames/frame-requests";
import { remixCreditsOf, scryfallRemixMechanics } from "@/lib/ai/remix-mechanics";
import { importedAnatomy, importedFormAnatomy, newCardFrameStyle } from "@/lib/cards/anatomy";
import { resolveDfcBackFace, dfcFrontTypeError, dfcFrontColorError } from "@/lib/cards/dfc-gate";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { backFaceSchema } from "@/lib/validation/card";
import { isKnownFrameSignature, signatureDrawnOn } from "@/lib/scryfall/frame-signatures";
import { backFaceFromPatch } from "@/lib/scryfall/preview-from-patch";
import { pickFrameColorKey } from "@/components/cards/frame-layer";
import type { ColorIdentity, DfcIconFamily, FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 5.4 — where a transform / modal printing lands (design 2026-10-02
// §2.4, §4, §5; owner Q2: walker faces wait; Q4: the remix at two credits;
// Q5: imports follow the printing's family, per face). Real (trimmed)
// Scryfall printings: fixtures/dfc-import-printings.json (captured
// 2026-10-05) plus the double-faced ones of the older fixture files. The
// REAL transform bodies (5.1a) and modal bodies (5.1b); the modal landing
// in full is dfc-imports-modal.test.ts.
// ---------------------------------------------------------------------------

// The double-faced fixture file wins: signature-printings.json carries
// trimmed twins of a few of its printings (ZNR #12's back without its text).
const ALL = { ...signaturePrintings, ...importPrintings, ...dfcPrintings } as Record<string, unknown>;
type Key =
  | keyof typeof dfcPrintings
  | "isd-51"
  | "mh3-237"
  | "ori-23"
  | "khm-114"
  | "znr-259"
  | "soi-281"
  | "neo-141"
  | "mid-7"
  | "znr-284"
  | "znr-305"
  | "mh3-253";
const printing = (key: Key): ScryfallCard => {
  const raw = ALL[key];
  if (!raw) throw new Error(`no fixture ${key}`);
  return scryfallCardSchema.parse(raw);
};
const patchOf = (key: Key) => mapScryfallToFormPatch(printing(key));

const keys = (...combos: [string, string][]) =>
  new Set(combos.map(([template, colour]) => frameComboKey(template as FrameTemplate, colour)));

/** Both bodies of a landing, in the faces' colours. */
function bothFaces(key: Key): Set<string> {
  const patch = patchOf(key);
  const front = patch.frame_template!;
  const back = patch.back_face!.frame_style!.template;
  return keys(
    [front, colourKeyOf(patch.color_identity)],
    [back, colourKeyOf(patch.back_face!.color_identity)],
  );
}
function colourKeyOf(colours: readonly ColorIdentity[] | undefined): string {
  return pickFrameColorKey(colours ? [...colours] : undefined);
}

describe("dfcImportOf — the one landing rule", () => {
  // [key, kind, front body, back body, family, front colour, back colour]
  const landings: Array<[Key, "transform", FrameTemplate, FrameTemplate, DfcIconFamily, string[], string[]]> = [
    // MID / VOW werewolves: the sun / moon family → the 2016–22 back (the
    // icon in the left well); the back's own colour (its indicator).
    ["mid-7", "transform", "m15dfcfront", "m15dfcbackleft", "sunmoon", ["white"], ["red"]],
    ["mid-169", "transform", "m15dfcfront", "m15dfcbackleft", "sunmoon", ["green"], ["green"]],
    ["vow-157", "transform", "m15dfcfront", "m15dfcbackleft", "sunmoon", ["red"], ["red"]],
    // No effect (INR, MOM) and `convertdfc` (BOT): the plain ▲ / ▼, the
    // ▼-right back; a two-colour back is gold (never split).
    ["inr-60", "transform", "m15dfcfront", "m15dfcback", "arrows", ["blue"], ["blue"]],
    ["mom-36", "transform", "m15dfcfront", "m15dfcback", "arrows", ["white"], ["multicolor"]],
    ["bot-1", "transform", "m15dfcfront", "m15dfcback", "arrows", ["white"], ["white"]],
    // Land faces wear the land pair, colourless (one master, verified on c):
    // an enchantment // land (XLN, compass), a creature // land (LCI), a
    // land // creature (SOI's Westvale Abbey, whose back is black).
    ["xln-22", "transform", "m15dfcfront", "m15dfclandback", "compass", ["white"], ["colorless"]],
    ["lci-26", "transform", "m15dfcfront", "m15dfclandback", "arrows", ["white"], ["colorless"]],
    ["soi-281", "transform", "m15dfclandfront", "m15dfcbackleft", "sunmoon", ["colorless"], ["black"]],
    // A 2003-frame printing lands on the M15 bodies too (the registry says
    // nearest, below).
    ["isd-51", "transform", "m15dfcfront", "m15dfcbackleft", "sunmoon", ["blue"], ["blue"]],
  ];

  it.each(landings)("%s → %s on %s // %s (%s)", (key, kind, front, back, family, frontColour, backColour) => {
    const facts = dfcImportOf(printing(key));
    expect(facts).toMatchObject({ layout: "transform", family, kind, frontBody: front, backBody: back, blocked: null });
    expect(kindFromScryfall(printing(key))).toBe(kind);
    const patch = patchOf(key);
    expect(patch.kind).toBe(kind);
    expect(patch.frame_template).toBe(front);
    expect(patch.printed_dfc_icon).toBe(family);
    expect(patch.color_identity).toEqual(frontColour);
    expect(patch.back_face).toMatchObject({ frame_style: { template: back }, color_identity: backColour });
    expect(patch.dropped_face).toBeUndefined();
    // The back's content rides as before: its own name, type and artist.
    expect(patch.back_face?.title).toBe(printing(key).card_faces![1]!.name);
    expect(frameTemplateFromScryfall(printing(key))).toBe(front);
  });

  it("the back's frame colour is the back face's own, single-select (backFrameColorsFromScryfall)", () => {
    expect(backFrameColorsFromScryfall(printing("mid-7"))).toEqual(["red"]);
    expect(backFrameColorsFromScryfall(printing("mom-36"))).toEqual(["multicolor"]);
    expect(backFrameColorsFromScryfall(printing("emn-63"))).toEqual(["colorless"]);
    // A land back by its mana (the patch stores it colourless all the same).
    expect(backFrameColorsFromScryfall(printing("xln-22"))).toEqual(["white"]);
    expect(backFrameColorsFromScryfall(printing("soi-281"))).toEqual(["black"]);
    expect(backFrameColorsFromScryfall(printing("khm-112"))).toEqual(["black"]);
    expect(backFrameColorsFromScryfall(printing("tmom-16"))).toEqual(["colorless"]);
  });

  it("a planeswalker face imports the front alone: the standard kind, the back dropped, and the toast says so (owner Q2)", () => {
    for (const key of ["ori-60", "ori-23", "mh3-237", "khm-114"] as const) {
      const facts = dfcImportOf(printing(key));
      expect(facts?.blocked, key).toBe("walker-face");
      expect(facts?.kind, key).toBeNull();
      expect(droppedFaceOf(printing(key)), key).toBe("walker-face");
      const patch = patchOf(key);
      expect(patch.kind, key).toBe("creature");
      expect(patch.frame_template, key).toBe("m15");
      expect(patch.back_face, key).toBeUndefined();
      expect(patch.dropped_face, key).toBe("walker-face");
      expect(patch.printed_dfc_icon, key).toBeUndefined();
    }
    expect(droppedFaceNotice(patchOf("ori-60"), "Jace, Vryn's Prodigy // Jace, Telepath Unbound")).toBe(
      "Jace, Vryn's Prodigy // Jace, Telepath Unbound has a planeswalker face — PipGlyph imported the front face, Jace, Vryn's Prodigy, on its own. Double-faced planeswalkers aren't supported yet.",
    );
  });

  it("a colourless face without the Artifact word keeps today's landing (D2, 5.11): the bodies are named, the import lands on the standard", () => {
    // EMN #63 Grizzled Angler's back is a colourless Eldrazi Fish.
    const facts = dfcImportOf(printing("emn-63"));
    expect(facts).toMatchObject({ blocked: "colourless-face", kind: null, frontBody: "m15dfcfront", backBody: "m15dfcbackleft", family: "moon" });
    const patch = patchOf("emn-63");
    expect(patch.kind).toBe("creature");
    expect(patch.frame_template).toBe("m15");
    expect(patch.printed_dfc_icon).toBeUndefined();
    // A legacy back: the content, no body, no colour of its own.
    expect(patch.back_face).toMatchObject({ title: "Grisly Anglerfish", card_type: "creature" });
    expect(patch.back_face?.frame_style).toBeUndefined();
    expect(patch.back_face?.color_identity).toBeUndefined();
    // A colourless ARTIFACT face wears `c` (Tergrid's Lantern is black on
    // the real print; the same face colourless would be an artifact).
    const tergrid = printing("khm-112");
    const lanternColourless = {
      ...tergrid,
      layout: "transform",
      card_faces: [tergrid.card_faces![0], { ...tergrid.card_faces![1], colors: [] }],
    } as ScryfallCard;
    expect(dfcImportOf(lanternColourless)).toMatchObject({ kind: "transform", backBody: "m15dfcback" });
    expect(mapScryfallToFormPatch(lanternColourless).back_face).toMatchObject({ color_identity: ["colorless"] });
  });

  it("a Saga, battle or token face keeps its own kind, as today (5.5)", () => {
    expect(dfcImportOf(printing("mom-20"))).toMatchObject({ blocked: "face-type", kind: null });
    expect(patchOf("mom-20")).toMatchObject({ kind: "battle", card_type: "battle" });
    expect(patchOf("mom-20").back_face).toMatchObject({ title: "Belenon War Anthem", card_type: "enchantment" });
    expect(patchOf("mom-20").back_face?.frame_style).toBeUndefined();
    expect(kindFromScryfall(printing("neo-141"))).toBe("saga");
    expect(dfcImportOf(printing("neo-141"))).toMatchObject({ blocked: "face-type" });
    // A double-faced token is not a transform / modal layout at all.
    expect(dfcImportOf(printing("tmom-16"))).toBeNull();
    expect(patchOf("tmom-16")).toMatchObject({ kind: "token", dropped_face: "double-faced-token" });
  });

  it("a modal printing lands on the modal bodies (5.1b): the Modal kind, the front body by the front's type, the back body by the back's, no family", () => {
    for (const [key, front, back, backColour] of [
      ["znr-12", "m15mdfcfront", "m15mdfclandback", ["white"]],
      ["khm-112", "m15mdfcfront", "m15mdfcback", ["black"]],
      ["stx-147", "m15mdfcfront", "m15mdfcback", ["blue"]],
      ["znr-259", "m15mdfclandfront", "m15mdfclandback", undefined],
    ] as const) {
      expect(dfcImportOf(printing(key)), key).toMatchObject({ layout: "modal", blocked: null, kind: "mdfc", frontBody: front, backBody: back });
      const patch = patchOf(key);
      expect(patch.kind, key).toBe("mdfc");
      expect(patch.frame_template, key).toBe(front);
      expect(patch.back_face?.frame_style, key).toEqual({ template: back });
      // A modal LAND face keeps the colour its mana ability adds (Emeria's
      // back is white): the modal land pair is one tint per colour.
      if (backColour) expect(patch.back_face?.color_identity, key).toEqual(backColour);
      expect(patch.printed_dfc_icon, key).toBeUndefined();
    }
    // STX #6 Wandering Archaic's front is a colourless Avatar: the body's
    // `c` is the artifact stand-in, so the printing keeps today's landing
    // (5.11); MH3 #253's devoid dress likewise (`dress`).
    expect(dfcImportOf(printing("stx-6"))).toMatchObject({ blocked: "colourless-face", frontBody: "m15mdfcfront" });
    expect(dfcImportOf(printing("mh3-253"))).toMatchObject({ blocked: "dress", frontBody: "m15mdfcfront", backBody: "m15mdfclandback" });
  });
});

describe("the registry", () => {
  // [key, signature, status, template, landOn, blockedBy]
  const rows: Array<[Key, string, "exact" | "nearest", FrameTemplate, FrameTemplate | undefined, string | undefined]> = [
    ["mid-7", "transform/2015", "exact", "m15dfcfront", undefined, undefined],
    ["mid-169", "transform/2015", "exact", "m15dfcfront", undefined, undefined],
    ["inr-60", "transform/2015", "exact", "m15dfcfront", undefined, undefined],
    ["vow-157", "transform/2015", "exact", "m15dfcfront", undefined, undefined],
    ["mom-36", "transform/2015", "exact", "m15dfcfront", undefined, undefined],
    // A legendary BOT convert: the crown (4.6f) and its Vehicle back (5.10)
    // are gaps on the body.
    ["bot-1", "transform/2015+crown", "nearest", "m15dfcfront", undefined, "4.6f"],
    // The Ixalan parchment land back (5.8) — on XLN's compass printings and
    // LCI's plain ones alike; the land front lands on the land pair.
    ["xln-22", "transform/2015+parchment-land-back", "nearest", "m15dfcfront", undefined, "5.8"],
    ["lci-26", "transform/2015+parchment-land-back", "nearest", "m15dfcfront", undefined, "5.8"],
    ["soi-281", "transform/2015", "exact", "m15dfclandfront", undefined, undefined],
    // Pre-2015 frames land nearest on the M15 bodies.
    ["isd-51", "dfc/2003", "nearest", "m15dfcfront", undefined, "4.10"],
    // Walker faces wait (5.13); a colourless face is the body's frame,
    // landing on the standard (5.11); a devoid dress the body's frame,
    // landing on the devoid frame (5.11); the modal printings exact on the
    // modal front body (5.1b).
    ["ori-60", "dfc/walker", "nearest", "m15", undefined, "5.13"],
    ["ori-23", "dfc/walker", "nearest", "m15", undefined, "5.13"],
    ["khm-114", "dfc/walker", "nearest", "m15", undefined, "5.13"],
    ["emn-63", "dfc/colourless-face", "nearest", "m15dfcfront", "m15", "5.11"],
    ["znr-12", "modal/2015", "exact", "m15mdfcfront", undefined, undefined],
    // Tergrid is legendary: the crown is a gap on the body (4.6f), as BOT #1's.
    ["khm-112", "modal/2015+crown", "nearest", "m15mdfcfront", undefined, "4.6f"],
    ["stx-6", "dfc/colourless-face", "nearest", "m15mdfcfront", "m15", "5.11"],
    ["znr-259", "modal/2015", "exact", "m15mdfclandfront", undefined, undefined],
    ["mh3-253", "dfc/devoid", "nearest", "m15mdfcfront", "m15devoid", "5.11"],
    // A borderless modal Pathway: nearest on the modal land front (5.7).
    ["znr-284", "borderless/dfc", "nearest", "m15mdfclandfront", undefined, "5.7"],
    // A battle front and a Saga front keep their frames; the marks are 5.5's.
    ["mom-20", "era/2015+dfc", "nearest", "battle", undefined, "5.5"],
    ["neo-141", "layout/2015+dfc", "nearest", "saga", undefined, "5.5"],
  ];

  it.each(rows)("%s → %s (%s on %s, landOn %s)", (key, signature, status, template, landOn, blockedBy) => {
    const match = frameMatchFromScryfall(printing(key));
    expect([match.signature, match.status, match.template, match.landOn]).toEqual([signature, status, template, landOn]);
    if (blockedBy) expect(match.blockedBy).toBe(blockedBy);
    expect(isKnownFrameSignature(match.signature)).toBe(true);
  });

  it("names the Vehicle plate on a convert's back, after the crown", () => {
    expect(frameMatchFromScryfall(printing("bot-1")).gaps).toEqual(["crown", "vehicle"]);
  });

  it("the double-faced marks are drawn by the bodies: the old dfc rows are answered there, never the standard's", () => {
    expect(signatureDrawnOn("era/2015+dfc", "m15dfcfront")).toBe(false);
    expect(signatureDrawnOn("era/2015+dfc", "m15")).toBe(false);
    const battle = frameMatchFromScryfall(printing("mom-20"));
    expect(battle.reason).toBe("PipGlyph doesn't draw the double-faced marks on this frame yet");
  });

  it("logs a `dfc/walker` request row for a walker-faced import (the asks are counted)", () => {
    const row = frameRequestFromImport(patchOf("ori-23"), { artImported: false, source: "import", verifiedKeys: new Set() });
    expect(row).toMatchObject({ signature: "dfc/walker", status: "nearest", cause: "missing", template: "m15", setCode: "ori", collectorNumber: "23" });
  });
});

describe("finalizeImportMatch — a landing is verified on BOTH faces", () => {
  it("nothing ticked: today's landing, the front body 'not yet verified'", () => {
    const patch = finalizeImportMatch(patchOf("mid-7"), new Set());
    expect(patch.kind).toBe("creature");
    expect(patch.frame_template).toBe("m15");
    expect(patch.frame_match).toMatchObject({ status: "nearest", template: "m15dfcfront", landOn: "m15", unverified: true, reason: "not yet verified in white" });
    expect(patch.back_face).toMatchObject({ title: "Moonrage Brute" });
    expect(patch.back_face?.frame_style).toBeUndefined();
    expect(patch.back_face?.color_identity).toBeUndefined();
    // The family is a fact about the printing and stays; the save drops the
    // key on a frame that draws none.
    expect(patch.printed_dfc_icon).toBe("sunmoon");
    expect(isDfcImportPatch(patch)).toBe(false);
  });

  it("the front ticked, the back not: today's landing, naming the back", () => {
    const patch = finalizeImportMatch(patchOf("mid-7"), keys(["m15dfcfront", "w"]));
    expect(patch.kind).toBe("creature");
    expect(patch.frame_match).toMatchObject({ status: "nearest", landOn: "m15", unverified: true, reason: "the back face's frame isn't verified in red yet" });
    // The grid's per-printing match says the same.
    expect(verifiedFrameMatchFromScryfall(printing("mid-7"), keys(["m15dfcfront", "w"]))).toMatchObject({ status: "nearest", unverified: true, landOn: "m15" });
  });

  it("both ticked: the printing lands on its bodies, exact", () => {
    const verified = bothFaces("mid-7");
    const patch = finalizeImportMatch(patchOf("mid-7"), verified);
    expect(patch).toMatchObject({ kind: "transform", frame_template: "m15dfcfront", printed_dfc_icon: "sunmoon" });
    expect(patch.frame_match).toMatchObject({ status: "exact", template: "m15dfcfront" });
    expect(patch.frame_match?.landOn).toBeUndefined();
    expect(patch.back_face).toMatchObject({ frame_style: { template: "m15dfcbackleft" }, color_identity: ["red"] });
    expect(dfcImportLanding(patch, verified)).toMatchObject({ ok: true, frontBody: "m15dfcfront", backBody: "m15dfcbackleft", backColorIdentity: ["red"] });
    expect(verifiedFrameMatchFromScryfall(printing("mid-7"), verified)).toMatchObject({ status: "exact", template: "m15dfcfront" });
    // No frame request: the match is exact.
    expect(frameRequestFromImport(patch, { artImported: false, source: "import", verifiedKeys: verified })).toBeNull();
  });

  it("a nearest match keeps its own reason when a body isn't ticked (Delver on the 2003 frame)", () => {
    const patch = finalizeImportMatch(patchOf("isd-51"), keys(["m15dfcfront", "u"]));
    expect(patch.kind).toBe("creature");
    expect(patch.frame_match).toMatchObject({ signature: "dfc/2003", status: "nearest", landOn: "m15", reason: "PipGlyph's transform frames are M15-era" });
    expect(patch.frame_match?.unverified).toBeUndefined();
    const both = finalizeImportMatch(patchOf("isd-51"), bothFaces("isd-51"));
    expect(both).toMatchObject({ kind: "transform", frame_template: "m15dfcfront" });
    expect(both.frame_match).toMatchObject({ signature: "dfc/2003", status: "nearest" });
  });

  it("withoutDfcLanding is today's patch: the standard kind and frame, a legacy back", () => {
    const fallback = withoutDfcLanding(patchOf("soi-281"));
    expect(fallback).toMatchObject({ kind: "land", frame_template: "m15land" });
    expect(fallback.back_face).toMatchObject({ title: "Ormendahl, Profane Prince" });
    expect(fallback.back_face?.frame_style).toBeUndefined();
    expect(withoutDfcLanding(patchOf("ori-23"))).toEqual(patchOf("ori-23"));
  });
});

describe("the patch passes the server's gate", () => {
  it("the back face the mapper writes is what createCardAction derives and stores", () => {
    for (const key of ["mid-7", "inr-60", "xln-22", "soi-281", "mom-36"] as const) {
      const patch = patchOf(key);
      const back = patch.back_face!;
      // The back as the remix (and the creator's submit) sends it: the
      // content in the jsonb shape, the body and the colour.
      const payload = {
        ...backFaceFromPatch(back)!,
        frame_style: back.frame_style,
        color_identity: back.color_identity,
      };
      expect(backFaceSchema.safeParse(payload).success, key).toBe(true);
      expect(dfcFrontTypeError(patch.frame_template, patch.card_type), key).toBeNull();
      expect(dfcFrontColorError(patch.frame_template, { cardType: patch.card_type, supertype: patch.supertype }, patch.color_identity), key).toBeNull();
      const gate = resolveDfcBackFace({
        frontTemplate: patch.frame_template,
        back: payload,
        family: patch.printed_dfc_icon,
        frontColorIdentity: patch.color_identity,
        verifiedKeys: bothFaces(key),
      });
      expect(gate.ok, key).toBe(true);
      if (gate.ok) {
        expect(gate.back?.frame_style, key).toEqual(back.frame_style);
        expect(gate.back?.color_identity, key).toEqual(back.color_identity);
        // A transform back saves with no cost.
        expect(gate.back && "cost" in gate.back, key).toBe(false);
      }
    }
  });

  it("the creator and the AI deck remix store the same frame style, family included (the parity test's rule)", () => {
    for (const key of ["mid-7", "inr-60", "xln-22", "soi-281", "bot-1"] as const) {
      const patch = patchOf(key);
      const verified = bothFaces(key);
      const remix = scryfallRemixMechanics(patch, key, verified);
      if (!remix.ok) throw new Error(`${key}: ${remix.error}`);
      const { frame_template: template, card_type: cardType } = remix.mechanics;
      const ai = newCardFrameStyle({ template, ...remix.mechanics.anatomy }, cardType);
      const creator = newCardFrameStyle({ template, ...importedFormAnatomy(importedAnatomy(patch, template).style) }, cardType);
      expect(creator, key).toEqual(ai);
      expect(ai.dfcIcon, key).toBe(patch.printed_dfc_icon);
    }
  });
});

describe("the AI deck remix", () => {
  it("keeps the back with its body and colour on a double-faced body, at two credits", () => {
    const verified = bothFaces("mid-7");
    const frame = remixFrameFor(patchOf("mid-7"), verified);
    expect(frame).toEqual({ ok: true, template: "m15dfcfront", card_type: "creature" });
    const remix = scryfallRemixMechanics(patchOf("mid-7"), "Brutal Cathar", verified);
    if (!remix.ok) throw new Error(remix.error);
    expect(remix.mechanics).toMatchObject({
      frame_template: "m15dfcfront",
      anatomy: { dfcIcon: "sunmoon" },
      back_face: { title: "Moonrage Brute", frame_style: { template: "m15dfcbackleft" }, color_identity: ["red"], artist_credit: undefined, art_url: undefined },
    });
    expect(remixCreditsOf(remix.mechanics)).toBe(DFC_REMIX_CREDITS);
    // A land front on the land pair, its creature back on the family's body.
    const abbey = scryfallRemixMechanics(patchOf("soi-281"), "Westvale Abbey", bothFaces("soi-281"));
    if (!abbey.ok) throw new Error(abbey.error);
    expect(abbey.mechanics).toMatchObject({ frame_template: "m15dfclandfront", card_type: "land", color_identity: ["colorless"], back_face: { frame_style: { template: "m15dfcbackleft" }, color_identity: ["black"] } });
  });

  it("falls to the standard path, one-faced at one credit, until both bodies are ticked — never a body with no back", () => {
    for (const verified of [keys(["m15", "w"]), keys(["m15", "w"], ["m15dfcfront", "w"]), keys(["m15", "w"], ["m15dfcbackleft", "r"])]) {
      const remix = scryfallRemixMechanics(patchOf("mid-7"), "Brutal Cathar", verified);
      if (!remix.ok) throw new Error(remix.error);
      expect(remix.mechanics.frame_template).toBe("m15");
      expect(remix.mechanics.back_face).toBeUndefined();
      // The family rides only on a transform front body: the standard frame
      // stores none (the payload says only what the frame draws).
      expect(remix.mechanics.anatomy.dfcIcon).toBeUndefined();
      expect(newCardFrameStyle({ template: "m15", ...remix.mechanics.anatomy }, "creature").dfcIcon).toBeUndefined();
      expect(remixCreditsOf(remix.mechanics)).toBe(1);
    }
  });

  it("a one-credit plan stays one-faced whatever is ticked (singleFace)", () => {
    const remix = scryfallRemixMechanics(patchOf("mid-7"), "Brutal Cathar", new Set([...bothFaces("mid-7"), ...keys(["m15", "w"])]), { singleFace: true });
    if (!remix.ok) throw new Error(remix.error);
    expect(remix.mechanics).toMatchObject({ frame_template: "m15" });
    expect(remix.mechanics.back_face).toBeUndefined();
    expect(remixCreditsOf(remix.mechanics)).toBe(1);
  });

  it("a walker-faced printing remixes its front alone (one credit), a blocked colourless face likewise", () => {
    for (const key of ["ori-60", "emn-63"] as const) {
      const remix = scryfallRemixMechanics(patchOf(key), key, keys(["m15", "u"], ["m15dfcfront", "u"], ["m15dfcbackleft", "c"]));
      if (!remix.ok) throw new Error(remix.error);
      expect(remix.mechanics.frame_template, key).toBe("m15");
      expect(remix.mechanics.back_face, key).toBeUndefined();
      expect(remixCreditsOf(remix.mechanics), key).toBe(1);
    }
  });
});
