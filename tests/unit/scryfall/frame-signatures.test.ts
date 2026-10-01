import { describe, expect, it } from "vitest";
import { importedAnatomy } from "@/lib/cards/anatomy";
import printingsData from "./fixtures/signature-printings.json";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import {
  frameColorsFromScryfall,
  frameMatchFromScryfall,
  mapScryfallToFormPatch,
} from "@/lib/scryfall/import-mapper";
import {
  BORDER_PENDING_COLOURS,
  BORDER_PENDING_TEMPLATES,
  FRAME_SIGNATURE_KEYS,
  FRAME_SIGNATURE_RULES,
  TEMPLATES_WITHOUT_PRINTED_SIGNATURE,
  isBorderPending,
  isKnownFrameSignature,
  landFrameColorRule,
  registryCoversEveryTemplate,
  templatesReachedByRegistry,
  type FrameMatchStatus,
} from "@/lib/scryfall/frame-signatures";
import { EDGE_CONTRACT_KNOWN_FAILURES } from "@/lib/frames/edge-contract";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { finalizeImportMatch, withVerification } from "@/lib/creator/frame-resolve";
import { pickFrameColorKey } from "@/components/cards/frame-layer";
import { FRAME_TEMPLATE_VALUES, type FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// The frame signature registry (TODO 1.4, 1.17, 1.19). Every fixture is a
// real printing captured once from Scryfall (2026-09-28) and trimmed to the
// fields the registry, the importer and the reference check read; tests
// never call Scryfall.
// ---------------------------------------------------------------------------

type PrintingKey = keyof typeof printingsData;
const printing = (key: PrintingKey) => scryfallCardSchema.parse(printingsData[key]);
const colorKeyOf = (key: PrintingKey) => pickFrameColorKey(frameColorsFromScryfall(printing(key)));

// [fixture, status, template, landOn]
type Row = [PrintingKey, FrameMatchStatus, FrameTemplate, FrameTemplate | undefined];

describe("borderless families (TODO 1.17)", () => {
  const rows: Row[] = [
    // Standard: dark box = exact Borderless; the window-cropped art lands the
    // import on the bordered frame (1.18's owner decision).
    ["m21-315", "exact", "m15borderless", "m15"],
    ["fdn-311", "exact", "m15borderless", "m15"],
    ["blb-286", "exact", "m15borderless", "m15"],
    // WOT #64: anime art with no showcase flag — the standard frame (by eye).
    ["wot-64", "exact", "m15borderless", "m15"],
    // The crown is drawn since 4.6f (DMU #435, the floating crown: exact);
    // anatomy the frame doesn't draw: the nickname line (IKO #275).
    ["dmu-435", "exact", "m15borderless", "m15"],
    ["iko-275", "nearest", "m15borderless", "m15"],
    // Planeswalkers (4.33): the light borderless walker, regular (three
    // printed rows) or tall (four), landing on the bordered m15pw (the art
    // crop is the window, 1.18). A run of statics shares a printed row: NEO
    // #303 (Flash + a static + three abilities) is tall, ZNR #281 (two
    // statics + two abilities) regular. An `inverted` printing (WOE #297),
    // a black walker with dark bars (FDN #359, and BLC #78, whose dark bars
    // only look light over its pale art; AFR #284, CMR #512 and MED #GR2
    // are pinned light ones) and a two-colour split frame (ELD #271 GU,
    // DMU #375 GW) are nearest.
    ["m21-280", "exact", "m15borderlesspw", "m15pw"],
    ["m21-279", "exact", "m15borderlesspw", "m15pw"],
    ["znr-281", "exact", "m15borderlesspw", "m15pw"],
    ["m21-281", "exact", "m15borderlesspwtall", "m15pw"],
    ["neo-303", "exact", "m15borderlesspwtall", "m15pw"],
    ["afr-284", "exact", "m15borderlesspwtall", "m15pw"],
    ["cmr-512", "exact", "m15borderlesspwtall", "m15pw"],
    ["med-GR2", "exact", "m15borderlesspw", "m15pw"],
    ["blc-78", "nearest", "m15borderlesspw", "m15pw"],
    ["eld-271", "nearest", "m15borderlesspw", "m15pw"],
    ["woe-297", "nearest", "m15borderlesspwtall", "m15pw"],
    ["fdn-359", "nearest", "m15borderlesspwtall", "m15pw"],
    ["dmu-375", "nearest", "m15borderlesspwtall", "m15pw"],
    // What only the scans show (4.33 skeptic): the SDCC Bolas (PS19 #207)
    // prints the dark dress in gold and four rows on the regular box, Gideon
    // Blackblade (MED #WS2) two statics as two rows on the tall box, Comet
    // (UNF #275) a die-roll table on the tall box, and two Secret Lair
    // walkers (SLD #1619 / #1622) their names lettered across the art.
    ["ps19-207", "nearest", "m15borderlesspwtall", "m15pw"],
    ["med-WS2", "nearest", "m15borderlesspw", "m15pw"],
    ["unf-275", "nearest", "m15borderlesspw", "m15pw"],
    ["sld-1619", "nearest", "m15borderlesspw", "m15pw"],
    ["sld-1622", "nearest", "m15borderlesspw", "m15pw"],
    // Nonbasic lands (4.34): the borderless land frame, exact — and, its art
    // reaching the card edge, the import lands on the bordered land frame
    // (1.18). A mono-colour (MH3 #351), a colourless (CMM #663) and a
    // five-colour land (CMM #659, the gold master) are exact; the
    // two-colour lands print a split pinline and box (4.6), a crowned one
    // the floating crown (4.6), a nicknamed one its nickname line (6.3).
    ["mh3-351", "exact", "m15borderlessland", "m15land"],
    ["cmm-663", "exact", "m15borderlessland", "m15land"],
    ["cmm-659", "exact", "m15borderlessland", "m15land"],
    ["mid-281", "nearest", "m15borderlessland", "m15land"],
    ["otj-304", "nearest", "m15borderlessland", "m15land"],
    ["neo-413", "nearest", "m15borderlessland", "m15land"],
    ["ltc-361", "nearest", "m15borderlessland", "m15land"],
    // …and the two print variations Scryfall can't tell apart, pinned
    // (4.34's skeptic pass, by eye): the spells' dark type bar and box
    // (Cori Mountain Monastery TDM #393, Hall of Echoes FRA #379; Restless
    // Bivouac WOE #303 on its two-colour gap too), and the short box (the
    // triome SNC #291, the galaxy-foil SLD #469).
    ["tdm-393", "nearest", "m15borderlessland", "m15land"],
    ["fra-379", "nearest", "m15borderlessland", "m15land"],
    ["woe-303", "nearest", "m15borderlessland", "m15land"],
    ["snc-291", "nearest", "m15borderlessland", "m15land"],
    // …and the third look the second skeptic pass found: a dark type bar
    // alone over the tinted box (Theorist's Sanctum FRA #381, Mystic
    // Sanctuary SLD #2143).
    ["fra-381", "nearest", "m15borderlessland", "m15land"],
    ["sld-2143", "nearest", "m15borderlessland", "m15land"],
    ["sld-469", "nearest", "m15borderlessland", "m15land"],
    // MDFC (5.7), saga / adventure / room (4.38).
    ["znr-284", "nearest", "m15borderlessland", "m15land"],
    ["tdm-383", "nearest", "saga", undefined],
    ["woe-298", "nearest", "adventure", undefined],
    ["dsk-334", "nearest", "m15borderless", "m15"],
    // Showcase runs by collector number. BLB #295–336 is ONE woodland run
    // (#315 and #316 print the same frame, checked by eye); the anime frame
    // is the raised-foil #343–355. Every one is capped at nearest until its
    // border is true: 4.35's five, and the four 7.7's edge contract found
    // (bloomburrow, lotr, avatar, tarkirdraconic — owner decision A8).
    ["blb-295", "nearest", "bloomburrow", undefined],
    ["blb-316", "nearest", "bloomburrow", undefined],
    ["blb-343", "nearest", "bloomanime", undefined],
    ["ltr-306", "nearest", "lotr", undefined],
    ["tla-338", "nearest", "avatar", undefined],
    ["tle-315", "nearest", "avatar", undefined],
    // Text on the art (4.36): TDM clan, source material. `full_art` doesn't
    // exempt a printing from landOn: TLE #1's art_crop is the 626×457 window.
    ["tdm-327", "nearest", "m15borderless", "m15"],
    ["tle-1", "nearest", "m15borderless", "m15"],
    // Posters: unsupported for good, Borderless offered as the nearest (the
    // import lands on bordered M15: SPG #119 crops to the window too).
    ["spg-119", "unsupported", "m15borderless", "m15"],
    // …and HOB #284, the surge-foil twin of the HOB #248 book cover, which
    // Scryfall doesn't flag `poster` (pinned; a land, so the land frame).
    ["hob-284", "unsupported", "m15borderlessland", "m15land"],
    // Set frames: Mystical Archive, Stellar Sights (4.11); Amonkhet
    // Invocations unsupported.
    ["sta-1", "nearest", "m15borderless", "m15"],
    ["eos-1", "nearest", "m15borderlessland", "m15land"],
    ["mp2-1", "unsupported", "m15borderless", "m15"],
    // Tokens (4.37).
    ["wone-1", "nearest", "m15token", undefined],
    // Basics: textless → the textless land (UNF #235); the two-bar FRA run
    // → the borderless full-art basic (its bars print dark: nearest), which
    // lands on the land frame (its art_crop is the 626×457 window, 1.18) with
    // the borderless full-art basic offered (4.39).
    ["unf-235", "nearest", "m15textlessland", undefined],
    ["fra-382", "nearest", "fullartland", "m15land"],
    // Textless non-basic: the textless frame (its black ring, 4.35).
    ["msh-385", "nearest", "m15textless", undefined],
  ];

  it.each(rows)("%s → %s %s (landOn %s)", (key, status, template, landOn) => {
    const match = frameMatchFromScryfall(printing(key));
    expect([match.status, match.template, match.landOn]).toEqual([status, template, landOn]);
    expect(match.reason === null).toBe(status === "exact");
  });

  it("names why a borderless printing isn't exact", () => {
    // The crown gap dropped with 4.6f (gapDrawnBy: m15borderless draws the
    // floating crown); a crowned borderless printing is exact on its frame.
    expect(frameMatchFromScryfall(printing("dmu-435"))).toMatchObject({
      signature: "borderless/standard",
      status: "exact",
      template: "m15borderless",
    });
    expect(frameMatchFromScryfall(printing("dmu-435")).gaps).toBeUndefined();
    expect(frameMatchFromScryfall(printing("iko-275")).signature).toBe("borderless/standard+nickname");
    expect(frameMatchFromScryfall(printing("eld-271"))).toMatchObject({
      signature: "borderless/planeswalker+two-colour",
      blockedBy: "4.6f",
    });
    // A walker whose every coloured pip is hybrid keeps a two-colour gap —
    // the hybrid dress's own (4.6b split the gap; merged over 4.33's list).
    // Ajani DMU #375 prints a mixed cost (the gold-split dress); here its
    // cost made all hybrid.
    expect(frameMatchFromScryfall({ ...printing("dmu-375"), mana_cost: "{2}{G/W}{G/W}" })).toMatchObject({
      signature: "borderless/planeswalker+two-colour-hybrid",
      blockedBy: "4.6f",
    });
    expect(frameMatchFromScryfall(printing("dmu-375")).signature).toBe("borderless/planeswalker+two-colour");
    // `inverted`: the light frame is its nearest (owner decision
    // 2026-09-26), under a key of its own for the 1.6 log; so is a black
    // walker's dark-barred dress, which no Scryfall field names.
    expect(frameMatchFromScryfall(printing("woe-297"))).toMatchObject({
      signature: "borderless/planeswalker+inverted",
      blockedBy: "4.33",
      reason: expect.stringMatching(/inverted/),
    });
    expect(frameMatchFromScryfall(printing("fdn-359"))).toMatchObject({
      signature: "borderless/planeswalker+dark-bars",
      blockedBy: "4.33",
      reason: expect.stringMatching(/dark name and type bars/),
    });
    expect(frameMatchFromScryfall(printing("m21-280")).signature).toBe("borderless/planeswalker");
    expect(frameMatchFromScryfall(printing("afr-284")).signature).toBe("borderless/planeswalker");
    expect(frameMatchFromScryfall(printing("med-GR2")).signature).toBe("borderless/planeswalker");
    // BLC #78's bars look light over its pale art, but its ink is white:
    // the dark dress, never the pinned light one.
    expect(frameMatchFromScryfall(printing("blc-78")).signature).toBe("borderless/planeswalker+dark-bars");
    // No Scryfall field names these; the pins do, each under a key of its own
    // for the 1.6 log, every gap that holds listed (C1 reads them).
    expect(frameMatchFromScryfall(printing("ps19-207"))).toMatchObject({
      signature: "borderless/planeswalker+dark-bars",
      blockedBy: "4.33",
      reason: expect.stringMatching(/dark name and type bars/),
      gaps: ["dark-bars", "row-box"],
    });
    expect(frameMatchFromScryfall(printing("med-WS2"))).toMatchObject({
      signature: "borderless/planeswalker+row-box",
      blockedBy: "4.33",
      reason: expect.stringMatching(/other ability box/),
      gaps: ["row-box"],
    });
    expect(frameMatchFromScryfall(printing("unf-275"))).toMatchObject({
      signature: "borderless/planeswalker+two-colour",
      gaps: ["two-colour", "row-box"],
    });
    for (const key of ["sld-1619", "sld-1622"] as const) {
      expect(frameMatchFromScryfall(printing(key))).toMatchObject({
        signature: "borderless/planeswalker+lettered-name",
        blockedBy: "4.33",
        reason: expect.stringMatching(/letters its name across the art/),
        gaps: ["lettered-name"],
      });
    }
    // Nonbasic lands (4.34): the land's own gaps, never "no borderless land
    // frame" any more.
    expect(frameMatchFromScryfall(printing("mh3-351"))).toMatchObject({
      signature: "borderless/land",
      exactLabel: "Borderless land",
      reason: null,
    });
    expect(frameMatchFromScryfall(printing("mid-281"))).toMatchObject({
      signature: "borderless/land+two-colour",
      blockedBy: "4.6f",
      gaps: ["two-colour"],
    });
    expect(frameMatchFromScryfall(printing("neo-413"))).toMatchObject({
      signature: "borderless/land+crown",
      blockedBy: "4.6f",
    });
    expect(frameMatchFromScryfall(printing("ltc-361"))).toMatchObject({
      signature: "borderless/land+nickname",
      blockedBy: "6.3",
    });
    for (const key of ["mh3-351", "mid-281", "znr-284", "eos-1"] as const) {
      expect(frameMatchFromScryfall(printing(key)).blockedBy, key).not.toBe("4.34");
    }
    // The print variations the master doesn't draw (4.37's), pinned: the
    // spells' dark type bar and box, the short box — each named, and every
    // one that holds recorded (FrameMatch.gaps).
    expect(frameMatchFromScryfall(printing("tdm-393"))).toMatchObject({
      signature: "borderless/land+dark-type-and-box",
      reason: "this printing's type bar and text box are dark, and PipGlyph's Borderless Land tints them",
      blockedBy: "4.37",
      gaps: ["dark-type-and-box"],
    });
    expect(frameMatchFromScryfall(printing("fra-379")).signature).toBe("borderless/land+dark-type-and-box");
    expect(frameMatchFromScryfall(printing("woe-303"))).toMatchObject({
      signature: "borderless/land+two-colour",
      gaps: ["two-colour", "dark-type-and-box"],
    });
    expect(frameMatchFromScryfall(printing("snc-291"))).toMatchObject({
      signature: "borderless/land+short-box",
      reason: "this printing has the short text box, and PipGlyph's has the regular one",
      blockedBy: "4.37",
      gaps: ["short-box"],
    });
    expect(frameMatchFromScryfall(printing("sld-469"))).toMatchObject({
      signature: "borderless/land+short-box",
      gaps: ["short-box"],
    });
    for (const key of ["fra-381", "sld-2143"] as const) {
      expect(frameMatchFromScryfall(printing(key)), key).toMatchObject({
        signature: "borderless/land+dark-type-bar",
        reason: "this printing's type bar is dark, and PipGlyph's Borderless Land tints it",
        blockedBy: "4.37",
        gaps: ["dark-type-bar"],
      });
    }
    // The references stay exact: the pins name none of them.
    for (const key of ["mh3-351", "cmm-663", "cmm-659"] as const) {
      expect(frameMatchFromScryfall(printing(key)).gaps, key).toBeUndefined();
    }
    expect(frameMatchFromScryfall(printing("hob-284"))).toMatchObject({
      signature: "borderless/poster",
      forGood: true,
    });
    expect(frameMatchFromScryfall(printing("spg-119"))).toMatchObject({ forGood: true });
    expect(frameMatchFromScryfall(printing("blb-343"))).toMatchObject({
      blockedBy: "4.35",
      exactLabel: "Bloomburrow anime showcase",
    });
  });
});

describe("the borderless land frame, verified or not (TODO 4.34)", () => {
  const imported = (key: PrintingKey, verified: readonly string[]) =>
    finalizeImportMatch(mapScryfallToFormPatch(printing(key), { artPreviewUrl: null }), new Set(verified));

  it("is exact once verified in the card's colour, nearest ('not yet verified') until then — the import lands on the bordered land frame either way", () => {
    const before = imported("mh3-351", []);
    expect(before.frame_match).toMatchObject({
      status: "nearest",
      template: "m15borderlessland",
      landOn: "m15land",
      reason: "not yet verified in red",
      unverified: true,
    });
    expect(before.frame_template).toBe("m15land");
    const after = imported("mh3-351", [frameComboKey("m15borderlessland", "r")]);
    expect(after.frame_match).toMatchObject({ status: "exact", template: "m15borderlessland", landOn: "m15land", reason: null });
    expect("unverified" in (after.frame_match ?? {})).toBe(false);
    expect(after.frame_template).toBe("m15land");
    // Verified in another colour only: still nearest for a colourless land.
    expect(imported("cmm-663", [frameComboKey("m15borderlessland", "r")]).frame_match).toMatchObject({
      status: "nearest",
      reason: "not yet verified in colorless",
    });
    expect(imported("cmm-663", [frameComboKey("m15borderlessland", "c")]).frame_match?.status).toBe("exact");
  });

  it("keeps a two-colour land nearest even when the gold master is verified: its split pinline is 4.6's", () => {
    const out = imported("mid-281", [frameComboKey("m15borderlessland", "m")]);
    expect(out.frame_match).toMatchObject({ status: "nearest", template: "m15borderlessland", blockedBy: "4.6f" });
    expect(colorKeyOf("mid-281")).toBe("m");
    expect(out.frame_template).toBe("m15land");
  });
});

describe("full-art and textless families (TODO 1.19)", () => {
  const rows: Row[] = [
    // The 2022 full-art basic: exact on FDN / HOB / DSK, nearest on the 2023
    // ONE / MOM bars (the 4.39 amendment).
    ["fdn-282", "exact", "m15fullartland", undefined],
    ["hob-194", "exact", "m15fullartland", undefined],
    ["dsk-273", "exact", "m15fullartland", undefined],
    ["fin-309", "exact", "m15fullartland", undefined],
    ["one-262", "nearest", "m15fullartland", undefined],
    ["mom-282", "nearest", "m15fullartland", undefined],
    // Split bar (4.40), incl. the 2003 frame (ZEN) and MH1's snow basics.
    ["bfz-250", "nearest", "m15fullartland", undefined],
    ["znr-269", "nearest", "m15fullartland", undefined],
    ["znr-266", "nearest", "m15fullartland", undefined],
    ["snc-272", "nearest", "m15fullartland", undefined],
    ["mh1-250", "nearest", "m15fullartland", undefined],
    ["zen-230", "nearest", "m15fullartland", undefined],
    // Plain bar (4.41).
    ["thb-250", "nearest", "m15fullartland", undefined],
    ["spm-189", "nearest", "m15fullartland", undefined],
    // Coloured border (4.30) and per-set designs (4.11).
    ["dft-507", "nearest", "m15fullartland", undefined],
    ["neo-293", "nearest", "m15fullartland", undefined],
    ["lci-287", "nearest", "m15fullartland", undefined],
    ["ugl-84", "nearest", "m15fullartland", undefined],
    // Textless promos: black border (4.42), Future Sight (4.43). The 2003
    // ones (Player Rewards) name the 2003 frame until the textless frame is
    // verified in their colour (owner decision A9: onceVerified).
    ["sch-3", "nearest", "m15textless", undefined],
    ["pf19-1", "nearest", "m15textless", undefined],
    ["fra-402", "nearest", "m15textless", undefined],
    ["p07-1", "nearest", "modern", undefined],
    ["p10-1", "nearest", "modern", undefined],
    ["fut-19", "nearest", "m15textless", undefined],
    ["mb2-194", "nearest", "m15textless", undefined],
    ["trk-392", "unsupported", "m15land", undefined],
    // Tokens: a full-art token from M20 on wears the full-art design, which
    // PipGlyph doesn't draw yet (4.48): nearest the 2014–19 arch m15token
    // (TODO 1.23 — "the 2015 full-art token IS m15token" was wrong for it).
    // Older ones are 4.43's.
    ["t2xm-4", "nearest", "m15token", undefined],
    // A 2014–19 token that prints text wears the text-box arch (TODO 4.49
    // (b)): TDOM #2 Knight "Vigilance"; TXLN #7 Treasure its artifact dress.
    // Exact here; withVerification makes it nearest until it is verified.
    ["tdom-2", "exact", "m15tokentext", undefined],
    ["txln-7", "exact", "m15tokenartifacttext", undefined],
    ["tlrw-3", "nearest", "m15token", undefined],
    ["tzen-3", "nearest", "m15token", undefined],
    // Japan showcase (black and white border).
    ["dsk-389", "nearest", "m15", undefined],
    ["fdn-428", "nearest", "m15", undefined],
    ["dsk-398", "nearest", "m15", undefined],
    // The Zeta Set: unsupported for good; one-offs nearest M15.
    ["slz-46", "unsupported", "m15", undefined],
    ["sld-364", "nearest", "m15", undefined],
    ["unh-120", "nearest", "split", undefined],
    // The look-alikes that are never full art.
    ["znr-293", "exact", "fullart", undefined],
    ["znr-305", "exact", "fullart", undefined],
    // The Expeditions: exact, but for the black and green masters (A8) —
    // Flooded Strand is multicolour (its two colours, landFrameColorRule).
    ["zne-1", "exact", "expeditionland", undefined],
  ];

  it.each(rows)("%s → %s %s (landOn %s)", (key, status, template, landOn) => {
    const match = frameMatchFromScryfall(printing(key));
    expect([match.status, match.template, match.landOn]).toEqual([status, template, landOn]);
  });

  it("rejects a substitute card: not a playable card", () => {
    expect(frameMatchFromScryfall(printing("sznr-1"))).toMatchObject({
      status: "unsupported",
      reject: true,
      forGood: true,
      signature: "substitute-card",
    });
  });

  it("names the 2003 frame for a 2003-frame textless promo until the textless frame is verified (A9)", () => {
    expect(frameMatchFromScryfall(printing("p07-1"))).toMatchObject({
      signature: "textless/old-frame",
      exactLabel: "2003 frame textless promo",
      template: "modern",
      onceVerified: "m15textless",
      blockedBy: "4.43",
    });
    expect(frameMatchFromScryfall(printing("p10-1")).onceVerified).toBe("m15textless");
    // Future Sight has no border-era frame of its own: the textless frame
    // stays its nearest, and nothing to swap.
    const future = frameMatchFromScryfall(printing("fut-19"));
    expect(future).toMatchObject({ signature: "textless/future", template: "m15textless" });
    expect(future.onceVerified).toBeUndefined();
    // A later frame that can't dress the kind is never named: the textless
    // frame has no loyalty slot, so a (synthetic) 2003-frame textless
    // planeswalker keeps its walker frame and nothing to swap.
    const walker = frameMatchFromScryfall(
      scryfallCardSchema.parse({
        ...printingsData["p07-1"],
        name: "A Walker",
        type_line: "Legendary Planeswalker — Ajani",
        loyalty: "4",
      }),
    );
    expect(walker).toMatchObject({ signature: "textless/old-frame", template: "m15pw" });
    expect(walker.onceVerified).toBeUndefined();
    // No other fixture names a frame for later — but the M20+ tokens, whose
    // full-art template takes over once verified (TODO 4.48, token/m20; the
    // borderless ones too, still nearest, 1.23).
    for (const key of Object.keys(printingsData) as PrintingKey[]) {
      const match = frameMatchFromScryfall(printing(key));
      if (!match.onceVerified) continue;
      if (match.signature.startsWith("token/m20") || match.signature === "borderless/token") {
        expect(match.onceVerified, key).toMatch(/^m20token/);
        continue;
      }
      expect(match.signature, key).toBe("textless/old-frame");
    }
  });

  it("names the full-art token design for a borderless token once it is verified — still nearest (1.23: every borderless token is M20+)", () => {
    // WONE #1 Cat (2023, borderless, vanilla 2/2): the textless arch stands
    // in, the full-art textless template takes over once verified in white.
    const cat = frameMatchFromScryfall(printing("wone-1"));
    expect(cat).toMatchObject({ signature: "borderless/token", status: "nearest", template: "m15token", onceVerified: "m20token", blockedBy: "4.37" });
    const allM20 = new Set(
      ["m20token", "m20tokentext", "m20tokentall", "m20tokenartifact", "m20tokenartifacttext", "m20tokenartifacttall"].flatMap((t) =>
        ["w", "u", "b", "r", "g", "c", "m"].map((k) => frameComboKey(t as FrameTemplate, k)),
      ),
    );
    const verified = withVerification(cat, "w", allM20);
    expect(verified).toMatchObject({ status: "nearest", template: "m20token", blockedBy: "4.37", reason: "PipGlyph doesn't have the borderless token frame yet" });
    expect(verified.onceVerified).toBeUndefined();
    // Not verified in the card's colour: the arch stands, and no "not yet
    // verified" rewrite (a borderless token is nearest either way).
    const waiting = withVerification(cat, "w", new Set([...allM20].filter((k) => !k.endsWith("/w"))));
    expect(waiting).toMatchObject({ status: "nearest", template: "m15token", reason: "PipGlyph doesn't have the borderless token frame yet" });
    expect(waiting.unverified).toBeUndefined();
    // The height follows the text (4.48's rule), the Artifact word the
    // artifact template.
    const withText = (extra: Record<string, unknown>) =>
      frameMatchFromScryfall(scryfallCardSchema.parse({ ...printingsData["wone-1"], ...extra }));
    expect(withText({ oracle_text: "Vigilance" }).onceVerified).toBe("m20tokentext");
    expect(
      withText({
        type_line: "Token Artifact — Food",
        oracle_text: "{2}, {T}, Sacrifice this token: You gain 3 life.",
        power: undefined,
        toughness: undefined,
      }).onceVerified,
    ).toBe("m20tokenartifacttext");
  });

  it("keys the full-art basics on set lists, never on the full_art flag alone", () => {
    expect(frameMatchFromScryfall(printing("bfz-250")).blockedBy).toBe("4.40");
    expect(frameMatchFromScryfall(printing("thb-250")).blockedBy).toBe("4.41");
    expect(frameMatchFromScryfall(printing("one-262")).blockedBy).toBe("4.39");
    expect(frameMatchFromScryfall(printing("sld-364")).reason).toBe("full-art one-off");
  });
});

describe("the general signatures (TODO 1.4)", () => {
  const rows: Row[] = [
    // Porcelain Legionnaire NPH #19: a white artifact creature on the 2003
    // frame prints the ARTIFACT frame, which only M15 has.
    ["nph-19", "nearest", "m15artifact", undefined],
    // Flooded Strand KTK #233: a fetch land prints its two colours — the
    // two-colour land frame m15land draws (TODO 4.6b).
    ["ktk-233", "exact", "m15land", undefined],
    // Evolving Wilds MSC #240 stays grey; Fabled Passage and Prismatic Vista
    // print the gold land frame (their scans).
    ["msc-240", "exact", "m15land", undefined],
    ["eld-244", "exact", "m15land", undefined],
    ["mh1-244", "exact", "m15land", undefined],
    ["zen-211", "nearest", "modernland", undefined],
    // Nyx: the THB constellation showcase IS the nyx frame, and an
    // Enchantment Creature borrows it (owner decision A3), so a god is exact
    // (once nyx is verified in its colour); the regular Nyx starfield
    // (THB #18, FDN #27) is M15 with a gap; THS on the 2003 frame is nearest
    // Nyx (Bident of Thassa THS #42).
    ["thb-259", "exact", "nyx", undefined],
    ["thb-18", "nearest", "m15", undefined],
    ["fdn-27", "nearest", "m15", undefined],
    ["ths-42", "nearest", "nyx", undefined],
    // Future Sight: unsupported, nearest M15.
    ["fut-18", "unsupported", "m15", undefined],
    // Extended art.
    ["woe-328", "exact", "extendedart", undefined],
    // Pinned showcase runs.
    ["ltr-482", "nearest", "lotrscroll", undefined],
    ["ltr-602", "nearest", "lotrscroll", "saga"],
    ["tdm-303", "nearest", "tarkirdraconic", undefined],
    ["tdm-320", "nearest", "tarkirdraconic", "adventure"],
    // The Ghostfire walkers (Ugin #399 / #409, Elspeth #401 / #411) print
    // the frame, but it draws no loyalty shield or ability rows: they land
    // on m15pw until the walker body exists (TODO 4.5a / 4.5b).
    ["tdm-399", "nearest", "tarkirghostfire", "m15pw"],
    ["tdm-400", "nearest", "tarkirghostfire", undefined],
    ["tdm-401", "nearest", "tarkirghostfire", "m15pw"],
    ["tdm-409", "nearest", "tarkirghostfire", "m15pw"],
    ["tdm-411", "nearest", "tarkirghostfire", "m15pw"],
    ["mul-1", "nearest", "tarkirdragon", undefined],
    ["mul-60", "nearest", "tarkirdragon", undefined],
    ["mul-5", "nearest", "m15", undefined],
    // A snow ARTIFACT prints the snow frame, which the Artifact kind can't
    // take yet: it lands on the artifact frame.
    ["khm-244", "nearest", "m15snow", "m15artifact"],
    // Anatomy gaps on the M15 era: the double-faced marks, the silver
    // border + Un-host layout. The crown is drawn on m15 since TODO 4.6a (a
    // crowned mono legendary is exact), and a two-colour land is no gap
    // since 4.6b: m15land draws its split (Bloodfell Caves KTK #229).
    ["dmu-107", "exact", "m15", undefined],
    ["mid-7", "nearest", "m15", undefined],
    ["ktk-229", "exact", "m15land", undefined],
    ["ust-1", "nearest", "m15", undefined],
  ];

  it.each(rows)("%s → %s %s (landOn %s)", (key, status, template, landOn) => {
    const match = frameMatchFromScryfall(printing(key));
    expect([match.status, match.template, match.landOn]).toEqual([status, template, landOn]);
  });

  it("names the anatomy gap and the blocking item", () => {
    // The crown on a frame that doesn't draw it (snow: 4.6f); m15 does (4.6a).
    const snow = scryfallCardSchema.parse({ ...printingsData["dmu-107"], frame_effects: ["legendary", "snow"] });
    expect(frameMatchFromScryfall(snow)).toMatchObject({
      signature: "era/2015+crown",
      template: "m15snow",
      blockedBy: "4.6f",
      reason: "PipGlyph doesn't draw the legendary crown on this frame yet",
    });
    expect(frameMatchFromScryfall(printing("dmu-107"))).toMatchObject({ status: "exact", signature: "era/2015" });
    expect(frameMatchFromScryfall(printing("mid-7")).signature).toBe("era/2015+dfc");
    expect(frameMatchFromScryfall(printing("thb-18")).signature).toBe("era/2015+nyx");
    // The two-colour land frame is drawn (4.6b): the plain era signature.
    expect(frameMatchFromScryfall(printing("ktk-233"))).toMatchObject({ status: "exact", signature: "era/2015" });
    expect(frameMatchFromScryfall(printing("nph-19")).signature).toBe("era/2003/coloured-artifact");
    expect(frameMatchFromScryfall(printing("fut-18"))).toMatchObject({
      signature: "future",
      exactLabel: "Future Sight frame",
      blockedBy: "4.15",
    });
  });

  it("lists every anatomy gap that holds, the reason's first (FrameMatch.gaps, for the import dialog's C1)", () => {
    // The crown m15 draws is no gap (4.6a).
    expect(frameMatchFromScryfall(printing("dmu-107")).gaps).toBeUndefined();
    // The nickname names the reason; the crown and the two-colour frame are
    // drawn on Borderless since 4.6f (wave 2a), so they are no gaps there.
    expect(frameMatchFromScryfall(printing("iko-275")).gaps).toEqual(["nickname"]);
    // A Nyx legendary lands on m15, which draws its crown: the starfield only.
    expect(frameMatchFromScryfall(printing("thb-18")).gaps).toEqual(["nyx"]);
    // A synthetic colour-indicator dot on a legendary: the crown is drawn,
    // the dot isn't.
    const indicator = scryfallCardSchema.parse({ ...printingsData["dmu-107"], color_indicator: ["B"] });
    expect(frameMatchFromScryfall(indicator)).toMatchObject({
      signature: "era/2015+colour-indicator",
      gaps: ["colour-indicator"],
    });
    // …and on the snow frame, both, in order.
    const snowIndicator = scryfallCardSchema.parse({
      ...printingsData["dmu-107"],
      frame_effects: ["legendary", "snow"],
      color_indicator: ["B"],
    });
    expect(frameMatchFromScryfall(snowIndicator).gaps).toEqual(["crown", "colour-indicator"]);
    // No gap rule matched: no list (an exact frame, a nearest showcase).
    expect(frameMatchFromScryfall(printing("m21-315")).gaps).toBeUndefined();
    expect(frameMatchFromScryfall(printing("blb-343")).gaps).toBeUndefined();
  });

  it("keeps the white ghostfire run nearest for its border (4.30), not only the ring (4.35)", () => {
    expect(frameMatchFromScryfall(printing("tdm-409"))).toMatchObject({
      signature: "showcase/tdm/ghostfire/white",
      blockedBy: "4.30",
    });
    // The black run's creature (Ugin #399 is a planeswalker, which the kind
    // check caps first — TODO 4.5a).
    expect(frameMatchFromScryfall(printing("tdm-400"))).toMatchObject({
      signature: "showcase/tdm/ghostfire",
      blockedBy: "4.35",
    });
  });

  it("says why a frame that can't dress the kind lands elsewhere", () => {
    expect(frameMatchFromScryfall(printing("khm-244")).reason).toBe(
      "PipGlyph's M15 (2015) Snow frame doesn't dress artifacts yet",
    );
  });

  // TODO 4.5a: the IP showcases draw no loyalty shield and no ability rows,
  // so their walker printings land on m15pw — the Ghostfire run (a walker
  // body is 4.5b's) and the Bloomburrow anime Ral (BLB #353, which the owner
  // refused a body for, 2026-09-29). Captured from Scryfall 2026-09-29.
  it("lands a showcase walker printing on m15pw, naming the missing kind", () => {
    expect(frameMatchFromScryfall(printing("tdm-399"))).toMatchObject({
      status: "nearest",
      template: "tarkirghostfire",
      landOn: "m15pw",
      reason: "PipGlyph's Tarkir: Dragonstorm Ghostfire frame doesn't dress planeswalkers yet",
    });
    expect(frameMatchFromScryfall(printing("blb-353"))).toMatchObject({
      status: "nearest",
      signature: "showcase/blb/anime",
      template: "bloomanime",
      landOn: "m15pw",
      reason: "PipGlyph's Bloomburrow Anime frame doesn't dress planeswalkers yet",
    });
    // The white run keeps its border blocker next to the kind.
    expect(frameMatchFromScryfall(printing("tdm-411"))).toMatchObject({
      landOn: "m15pw",
      blockedBy: "4.30",
      reason: "PipGlyph doesn't print a white border yet; PipGlyph's Tarkir: Dragonstorm Ghostfire frame doesn't dress planeswalkers yet",
    });
    // The anime run's creatures still land on the anime frame.
    expect(frameMatchFromScryfall(printing("blb-343")).landOn).toBeUndefined();
  });

  it("dresses a Theros god on Nyx because its type line says Enchantment (A3)", () => {
    expect(frameMatchFromScryfall(printing("thb-259"))).toMatchObject({
      status: "exact",
      template: "nyx",
      signature: "showcase/thb/constellation",
      reason: null,
    });
    // The same printing typed as a plain creature: Nyx is borrowed for an
    // Enchantment Creature only, so it lands on M15 and says why.
    const plain = scryfallCardSchema.parse({
      ...printingsData["thb-259"],
      type_line: "Legendary Creature — God",
    });
    expect(frameMatchFromScryfall(plain)).toMatchObject({
      status: "nearest",
      template: "nyx",
      landOn: "m15",
      reason: "PipGlyph's Nyx Constellation frame dresses a creature only when it is an enchantment",
    });
    // A THS god on the 2003 frame keeps its nearest Nyx and now lands on it
    // once verified: no kind landing any more.
    const thsGod = scryfallCardSchema.parse({
      ...printingsData["ths-42"],
      name: "A God",
      type_line: "Legendary Enchantment Creature — God",
      colors: ["U"],
      color_identity: ["U"],
    });
    const god = frameMatchFromScryfall(thsGod);
    expect([god.status, god.template, god.landOn]).toEqual(["nearest", "nyx", undefined]);
  });
});

describe("the acceptance's named cases (TODO 1.4 (e))", () => {
  it("Porcelain Legionnaire NPH #19 → m15artifact, white, nearest", () => {
    const patch = mapScryfallToFormPatch(printing("nph-19"));
    expect(patch.frame_match).toMatchObject({ status: "nearest", template: "m15artifact" });
    expect(patch.frame_template).toBe("m15artifact");
    expect(colorKeyOf("nph-19")).toBe("w");
  });

  it("Flooded Strand KTK #233 → m15land, multicolour — its pair and two-colour frame from the fetched lands (TODO 4.6b)", () => {
    const patch = mapScryfallToFormPatch(printing("ktk-233"));
    expect(patch.frame_template).toBe("m15land");
    expect(patch.color_identity).toEqual(["multicolor"]);
    // m15land draws the pair: the land imports W|U with the switch on.
    expect(patch).toMatchObject({ color_pair: "wu", printed_two_color: true });
    // Not Legendary: the import names no crown switch (printing-only, owner
    // round 17), so the new-card default applies.
    expect(importedAnatomy(patch, "m15land")).toEqual({ style: { twoColor: true }, colorIdentity: ["white", "blue"] });
  });

  it("Bident of Thassa THS #42 → nyx, nearest", () => {
    const patch = mapScryfallToFormPatch(printing("ths-42"));
    expect(patch.frame_match).toMatchObject({ status: "nearest", template: "nyx" });
    expect(patch.frame_template).toBe("nyx");
  });

  it("a Future Sight printing → unsupported, nearest m15", () => {
    const patch = mapScryfallToFormPatch(printing("fut-18"));
    expect(patch.frame_match).toMatchObject({ status: "unsupported", template: "m15" });
    expect(patch.frame_template).toBe("m15");
  });

  it("Sheoldred DMU #435 → m15borderless, landing on bordered m15", () => {
    const patch = mapScryfallToFormPatch(printing("dmu-435"));
    expect(patch.frame_match).toMatchObject({ template: "m15borderless", landOn: "m15" });
    expect(patch.frame_template).toBe("m15");
  });

  it("FDN #282 → m15fullartland, exact", () => {
    expect(mapScryfallToFormPatch(printing("fdn-282")).frame_match).toMatchObject({
      status: "exact",
      template: "m15fullartland",
    });
  });

  it("a showcase walker imports as a planeswalker on m15pw (TODO 4.5a)", () => {
    for (const key of ["blb-353", "tdm-399", "tdm-401", "tdm-409", "tdm-411"] as const) {
      const patch = mapScryfallToFormPatch(printing(key));
      expect(patch.kind, key).toBe("planeswalker");
      expect(patch.frame_template, key).toBe("m15pw");
    }
  });

  it("layout kinds keep frame_template undefined (the kind fixes it) but carry the match", () => {
    const patch = mapScryfallToFormPatch(printing("tdm-320"));
    expect(patch.kind).toBe("adventure");
    expect(patch.frame_template).toBeUndefined();
    expect(patch.frame_match).toMatchObject({ template: "tarkirdraconic", landOn: "adventure" });
  });

  it("survives the route's JSON hop", () => {
    const patch = mapScryfallToFormPatch(printing("dmu-435"));
    const wire = JSON.parse(JSON.stringify(patch)) as typeof patch;
    expect(wire.frame_match).toEqual(patch.frame_match);
  });
});

describe("fetch-land colours (landFrameColorRule)", () => {
  it("a fetch land for two basic land types prints those colours", () => {
    expect(landFrameColorRule(printing("ktk-233"))).toEqual(["W", "U"]);
    expect(landFrameColorRule(printing("zen-211"))).toEqual(["W", "R"]);
    expect(landFrameColorRule(printing("zne-1"))).toEqual(["W", "U"]);
  });

  it("a basic-land fetcher: Evolving Wilds grey, Fabled Passage and Prismatic Vista gold", () => {
    expect(landFrameColorRule(printing("msc-240"))).toBeNull();
    expect(colorKeyOf("msc-240")).toBe("c");
    expect(colorKeyOf("eld-244")).toBe("m");
    expect(colorKeyOf("mh1-244")).toBe("m");
  });

  it("Multiversal Passage prints gold on every printing, though Scryfall lists no mana (4.34's survey)", () => {
    // "Choose a basic land type": no produced mana, no identity — the
    // produced-mana rule read colourless (grey), and the borderless SPM
    // #206 was the one borderless land called exact in the wrong colour.
    for (const key of ["spm-180", "spm-206"] as const) {
      expect(printing(key).produced_mana ?? [], key).toEqual([]);
      expect(landFrameColorRule(printing(key)), key).toEqual(["W", "U", "B", "R", "G"]);
      expect(colorKeyOf(key), key).toBe("m");
    }
    expect(frameMatchFromScryfall(printing("spm-180"))).toMatchObject({ status: "exact", template: "m15land" });
    expect(frameMatchFromScryfall(printing("spm-206"))).toMatchObject({
      status: "exact",
      template: "m15borderlessland",
      landOn: "m15land",
    });
  });

  it("a land that produces mana keeps the produced-mana rule", () => {
    expect(landFrameColorRule(printing("ktk-229"))).toBeNull();
    expect(colorKeyOf("ktk-229")).toBe("m");
  });
});

describe("the rule table", () => {
  it("has unique signature keys, all known", () => {
    expect(new Set(FRAME_SIGNATURE_KEYS).size).toBe(FRAME_SIGNATURE_KEYS.length);
    for (const key of FRAME_SIGNATURE_KEYS) expect(isKnownFrameSignature(key)).toBe(true);
    expect(isKnownFrameSignature("borderless/made-up")).toBe(false);
    expect(isKnownFrameSignature(undefined)).toBe(false);
  });

  it("ends in a catch-all, so every printing gets a match", () => {
    expect(FRAME_SIGNATURE_RULES[FRAME_SIGNATURE_RULES.length - 1]?.key).toBe("unknown-frame");
    const odd = scryfallCardSchema.parse({ id: "x", name: "Odd", frame: "3021", type_line: "Sorcery" });
    expect(frameMatchFromScryfall(odd)).toMatchObject({ status: "nearest", template: "m15" });
  });

  it("(d) every FrameTemplate is some rule's outcome, or listed as having no printed signature", () => {
    const reached = templatesReachedByRegistry();
    const missing = FRAME_TEMPLATE_VALUES.filter(
      (t) => !reached.has(t) && !TEMPLATES_WITHOUT_PRINTED_SIGNATURE.includes(t),
    );
    expect(missing).toEqual([]);
    expect(registryCoversEveryTemplate()).toBe(true);
  });

  it("never calls a template whose border isn't true yet exact (4.35, A8)", () => {
    for (const key of Object.keys(printingsData) as PrintingKey[]) {
      const match = frameMatchFromScryfall(printing(key));
      if (isBorderPending(match.template, colorKeyOf(key))) expect(match.status, key).not.toBe("exact");
    }
  });

  it("caps exactly the edge contract's known failures, but alphaland's invisible corner specks (A8)", () => {
    // Fixing a master strikes it from EDGE_CONTRACT_KNOWN_FAILURES (its
    // it.fails turns red); this test then asks for the cap to go too.
    for (const [template, { keys }] of Object.entries(EDGE_CONTRACT_KNOWN_FAILURES)) {
      if (template === "alphaland") continue;
      if (keys === "all") {
        expect(BORDER_PENDING_TEMPLATES.has(template as FrameTemplate), template).toBe(true);
      } else {
        expect([...(BORDER_PENDING_COLOURS.get(template as FrameTemplate) ?? [])].sort(), template).toEqual(
          [...keys].sort(),
        );
      }
    }
    for (const template of [...BORDER_PENDING_TEMPLATES, ...BORDER_PENDING_COLOURS.keys()]) {
      expect(EDGE_CONTRACT_KNOWN_FAILURES[template], template).toBeDefined();
    }
    expect(EDGE_CONTRACT_KNOWN_FAILURES.alphaland?.why).toMatch(/^edges pass; corner:/);
  });

  it("names the border as the reason a capped showcase isn't exact (A8)", () => {
    for (const [key, frame] of [
      ["ltr-306", "The Lord of the Rings Ring"],
      ["tla-338", "Avatar: The Last Airbender"],
    ] as const) {
      const match = frameMatchFromScryfall(printing(key));
      expect(match.blockedBy, key).toBe("4.35");
      expect(match.reason, key).toMatch(/frame doesn't have the printed border yet$/);
      expect(match.reason, key).toContain(frame);
    }
  });

  it("caps the Expedition frame in black and green only (A8)", () => {
    // No printed Expedition is black or green (ZNE/EXP checked 2026-09-29):
    // the same printing, made to tap for one colour.
    const expedition = (mana: string) =>
      scryfallCardSchema.parse({
        ...printingsData["zne-1"],
        name: `Test Expedition ${mana}`,
        oracle_text: `{T}: Add {${mana}}.`,
        produced_mana: [mana],
        color_identity: [mana],
      });
    for (const mana of ["B", "G"]) {
      expect(frameMatchFromScryfall(expedition(mana)), mana).toMatchObject({
        status: "nearest",
        template: "expeditionland",
        blockedBy: "4.35",
      });
    }
    for (const mana of ["W", "U", "R"]) {
      expect(frameMatchFromScryfall(expedition(mana)).status, mana).toBe("exact");
    }
    expect(isBorderPending("expeditionland", "b")).toBe(true);
    expect(isBorderPending("expeditionland", "m")).toBe(false);
    expect(isBorderPending("lotr", "w")).toBe(true);
    expect(isBorderPending("m15", "w")).toBe(false);
  });

  it("an exact match never needs a reason, a non-exact one always has one", () => {
    for (const key of Object.keys(printingsData) as PrintingKey[]) {
      const match = frameMatchFromScryfall(printing(key));
      expect(match.reason === null, key).toBe(match.status === "exact");
      expect(isKnownFrameSignature(match.signature), key).toBe(true);
    }
  });
});
