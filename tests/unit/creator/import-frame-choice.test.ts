import { describe, expect, it } from "vitest";
import signaturePrintings from "../scryfall/fixtures/signature-printings.json";
import treatmentPrintings from "../scryfall/fixtures/treatment-printings.json";
import tokenPrintings from "../scryfall/fixtures/token-printings.json";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import { mapScryfallToFormPatch, type ScryfallImportPatch } from "@/lib/scryfall/import-mapper";
import { finalizeImportMatch } from "@/lib/creator/frame-resolve";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import {
  appliedImportFrameChoice,
  frameSubstitutionFor,
  frameSubstitutionLabel,
  importFramePlan,
  importSubstitutionMessage,
  onlyUndrawnDetailsMissing,
  theFrame,
  WINDOW_CROPPED_NOTE,
} from "@/lib/creator/import-frame-choice";

// ---------------------------------------------------------------------------
// TODO 1.5's frame chooser, as a pure plan over real (trimmed) Scryfall
// printings run through the real mapper and the route's verification step:
// when it shows, what it offers in the imported colour, what it preselects
// (resolveImportFrame's landing — 1.18's bordered M15 for a borderless
// printing), "keep my current frame", a substitute card's refusal, and the
// creator's re-check when it applies the pick. Owner decisions 2026-09-29:
// no chooser (and no deck pre-fill toast) for a printing short of only a
// colour indicator on its own frame (C1 / C3 — the crown too, until 4.6a drew
// it on m15 / m15artifact / m15land); the standard frame and the printing's
// family first, the rest behind "Show all frames" (C2).
// ---------------------------------------------------------------------------

const fixtures = { ...signaturePrintings, ...treatmentPrintings, ...tokenPrintings } as Record<
  string,
  unknown
>;
const EVERY_COLOUR = ["w", "u", "b", "r", "g", "c", "m"];
const verified = (...templates: string[]) =>
  new Set(templates.flatMap((t) => EVERY_COLOUR.map((k) => frameComboKey(t, k))));

/** The /api/scryfall/named patch: the mapper's, with the match finalized
 *  (the route's finalizeImportMatch). */
function namedPatch(key: string, keys: ReadonlySet<string>): ScryfallImportPatch {
  return finalizeImportMatch(mapScryfallToFormPatch(scryfallCardSchema.parse(fixtures[key])), keys);
}

/** A fixture printing with some fields changed — a synthetic variant for a
 *  gap combination no fixture has, run through the same mapper. */
function variantPatch(
  key: string,
  changes: Record<string, unknown>,
  keys: ReadonlySet<string>,
): ScryfallImportPatch {
  const raw = { ...(fixtures[key] as Record<string, unknown>), ...changes };
  return finalizeImportMatch(mapScryfallToFormPatch(scryfallCardSchema.parse(raw)), keys);
}

/** Sheoldred DMU #107 (legendary: the crown) as a black-red card: the crown
 *  and the two-colour split frame — which m15 draws since 4.6b, so only the
 *  crown holds. */
const twoColourLegend = (keys: ReadonlySet<string>) =>
  variantPatch(
    "dmu-107",
    { colors: ["B", "R"], color_identity: ["B", "R"], mana_cost: "{2}{B}{R}" },
    keys,
  );
/** …as a non-legendary card with a colour-indicator dot only. */
const indicatorOnly = (keys: ReadonlySet<string>) =>
  variantPatch(
    "dmu-107",
    { type_line: "Creature — Phyrexian Praetor", frame_effects: [], color_indicator: ["B"] },
    keys,
  );
/** …legendary with a colour-indicator dot: the crown m15 draws (4.6a) and a
 *  detail no frame draws. */
const legendWithIndicator = (keys: ReadonlySet<string>) =>
  variantPatch("dmu-107", { color_indicator: ["B"] }, keys);
/** …on the snow frame (KHM #179 Jorn's look): a crown m15snow doesn't draw
 *  (4.6f), where m15 does — a real choice. */
const snowLegend = (keys: ReadonlySet<string>) =>
  variantPatch("dmu-107", { frame_effects: ["legendary", "snow"] }, keys);
/** …as a W/U hybrid ARTIFACT creature (ELD #206-style cost): it lands on
 *  m15artifact, which draws the crown (4.6a) but has no hybrid dress (TODO
 *  4.6b), so the two-colour hybrid frame holds — a gap PipGlyph paints
 *  differently. */
const hybridArtifactLegend = (keys: ReadonlySet<string>) =>
  variantPatch(
    "dmu-107",
    {
      colors: ["W", "U"],
      color_identity: ["W", "U"],
      mana_cost: "{W/U}{W/U}{W/U}",
      type_line: "Legendary Artifact Creature — Phyrexian Praetor",
    },
    keys,
  );

const STANDARD = verified("m15", "m15artifact", "m15land", "m15pw", "m15token", "saga");
const WITH_BORDERLESS = new Set([...STANDARD, ...verified("m15borderless", "m15fullartland")]);
/** Every frame a creature can wear, for "Show all frames". */
const EVERYTHING = new Set([
  ...WITH_BORDERLESS,
  ...verified(
    "m15snow", "m15devoid", "agclassic", "retro", "modern", "m15borderlessartifact",
    "bloomburrow", "bloomanime", "tarkirdraconic", "tarkirghostfire", "lotr", "lotrscroll",
    "fullartland", "m15textless", "m15textlessland", "nyx",
  ),
]);

describe("importFramePlan — when the chooser shows", () => {
  it("an exact printing imports without asking (Evolving Wilds MSC #240, a 2014–19 Soldier token)", () => {
    expect(importFramePlan(namedPatch("msc-240", STANDARD), STANDARD, "m15")).toEqual({ mode: "none" });
    expect(importFramePlan(namedPatch("tdom-3", STANDARD), STANDARD, "m15")).toEqual({ mode: "none" });
  });

  it("an M20-design token asks, with the arch token frame preselected (TODO 1.23: T2XM #4 was exact)", () => {
    const plan = importFramePlan(namedPatch("t2xm-4", STANDARD), STANDARD, "m15");
    expect(plan).toMatchObject({
      mode: "choose",
      heading: "PipGlyph can't match this printing's M20 full-art token frame exactly yet — pick one of these",
      match: { status: "nearest", template: "m15token" },
      preselected: { template: "m15token" },
    });
    // A legendary M20 token is short of more than the crown: the frame
    // itself is a stand-in, so C1 never skips the chooser.
    // Its rules text asks for the text-box arch (4.49 (b)); unverified, the
    // textless arch it lands on is preselected (TEXT_BOX_TOKEN_FALLBACK).
    expect(importFramePlan(namedPatch("tmkm-13", STANDARD), STANDARD, "m15")).toMatchObject({
      mode: "choose",
      match: { status: "nearest", template: "m15tokentext" },
      preselected: { template: "m15token" },
    });
  });

  it("a substitute card is refused", () => {
    expect(importFramePlan(namedPatch("sznr-1", STANDARD), STANDARD, "m15")).toEqual({
      mode: "reject",
      exactLabel: "Double-faced substitute card",
      reason: "this is a substitute card, not a playable card",
    });
  });

  it("an older patch with no match never asks", () => {
    const patch = { ...namedPatch("dmu-435", STANDARD), frame_match: undefined };
    expect(importFramePlan(patch, STANDARD, "m15")).toEqual({ mode: "none" });
  });
});

describe("importFramePlan — borderless (1.18: lands on the bordered frame, Borderless offered)", () => {
  it("Sheoldred DMU #435 (crowned): exact since 4.6f — M15 preselected with the window-cropped note; Borderless listed once verified in black", () => {
    const plan = importFramePlan(namedPatch("dmu-435", WITH_BORDERLESS), WITH_BORDERLESS, "m15");
    if (plan.mode !== "choose") throw new Error(plan.mode);
    expect(plan.preselected).toEqual({ template: "m15" });
    expect(plan.windowCroppedNote).toBe(WINDOW_CROPPED_NOTE);
    expect(plan.options.map((o) => o.template)).toEqual(["m15", "m15borderless"]);
    expect(plan.options[0]).toMatchObject({ nearest: true, edgeToEdge: false });
    expect(plan.options[1]).toMatchObject({ nearest: false, edgeToEdge: true });
    // Borderless draws the floating crown (4.6f, wave 2a): the printing is
    // exact on its own frame, and only Scryfall's cropped art keeps the
    // chooser open (1.18), as for FDN #311.
    expect(plan.match).toMatchObject({ status: "exact", template: "m15borderless", landOn: "m15", reason: null });
    expect(plan.heading).toBe(
      "PipGlyph has the Borderless frame, but Scryfall's art won't fill it — pick one of these",
    );
    expect(plan.keepCurrent).toEqual({ template: "m15", available: true, reason: null });
  });

  it("…and Borderless is not listed while it is unverified in black", () => {
    const plan = importFramePlan(namedPatch("dmu-435", STANDARD), STANDARD, "m15");
    if (plan.mode !== "choose") throw new Error(plan.mode);
    expect(plan.options.map((o) => o.template)).toEqual(["m15"]);
    expect(plan.heading).toBe("PipGlyph doesn't have the Borderless frame yet — pick one of these");
  });

  it("an exact borderless printing (FDN #311) still asks: PipGlyph has the frame, the art can't fill it", () => {
    const plan = importFramePlan(namedPatch("fdn-311", WITH_BORDERLESS), WITH_BORDERLESS, "m15");
    if (plan.mode !== "choose") throw new Error(plan.mode);
    expect(plan.match.status).toBe("exact");
    expect(plan.heading).toBe(
      "PipGlyph has the Borderless frame, but Scryfall's art won't fill it — pick one of these",
    );
    expect(plan.preselected).toEqual({ template: "m15" });
    expect(plan.windowCroppedNote).toBe(WINDOW_CROPPED_NOTE);
  });

  it("a borderless basic (FRA #382) preselects the land frame; the full-art basic is offered to a basic only", () => {
    const plan = importFramePlan(namedPatch("fra-382", WITH_BORDERLESS), WITH_BORDERLESS, "m15");
    if (plan.mode !== "choose") throw new Error(plan.mode);
    expect(plan.preselected).toEqual({ template: "m15land" });
    expect(plan.options.map((o) => o.template)).toEqual(["m15land", "m15fullartland"]);
    // The creature frame the card is on can't dress a land.
    expect(plan.keepCurrent).toEqual({
      template: "m15",
      available: false,
      reason: "M15 (2015) Standard isn't published for land cards in white",
    });
  });
});

describe("importFramePlan — the borderless land (4.34)", () => {
  const LAND = new Set([...STANDARD, ...verified("m15borderlessland")]);

  it("an exact borderless land (Arena of Glory MH3 #351) asks: the land frame preselected, Borderless Land listed once verified", () => {
    const plan = importFramePlan(namedPatch("mh3-351", LAND), LAND, "m15");
    if (plan.mode !== "choose") throw new Error(plan.mode);
    expect(plan.match).toMatchObject({ status: "exact", template: "m15borderlessland", landOn: "m15land" });
    expect(plan.heading).toBe("PipGlyph has the Borderless land frame, but Scryfall's art won't fill it — pick one of these");
    expect(plan.preselected).toEqual({ template: "m15land" });
    expect(plan.windowCroppedNote).toBe(WINDOW_CROPPED_NOTE);
    expect(plan.options.map((o) => o.template)).toEqual(["m15land", "m15borderlessland"]);
    expect(plan.options[1]).toMatchObject({ nearest: false, edgeToEdge: true });
  });

  it("…and only the land frame while Borderless Land is unverified in red", () => {
    const plan = importFramePlan(namedPatch("mh3-351", STANDARD), STANDARD, "m15");
    if (plan.mode !== "choose") throw new Error(plan.mode);
    expect(plan.match).toMatchObject({ status: "nearest", reason: "not yet verified in red" });
    expect(plan.options.map((o) => o.template)).toEqual(["m15land"]);
    expect(plan.preselected).toEqual({ template: "m15land" });
  });

  it("a two-colour land (Deserted Beach MID #281): the gold Borderless Land offered as the nearest look (4.6's split pinline)", () => {
    const plan = importFramePlan(namedPatch("mid-281", LAND), LAND, "m15land");
    if (plan.mode !== "choose") throw new Error(plan.mode);
    expect(plan.match).toMatchObject({ status: "nearest", template: "m15borderlessland" });
    expect(plan.heading).toBe("PipGlyph can't match this printing's Borderless land exactly yet — pick one of these");
    expect(plan.options.map((o) => o.template)).toEqual(["m15land", "m15borderlessland"]);
    expect(plan.keepCurrent).toEqual({ template: "m15land", available: true, reason: null });
  });
});

describe("importFramePlan — the borderless planeswalkers (4.33)", () => {
  const WALKERS = new Set([...STANDARD, ...verified("m15borderlesspw", "m15borderlesspwtall")]);

  it("Teferi M21 #281 (four rows): m15pw preselected, the TALL borderless walker offered — never the regular one", () => {
    const plan = importFramePlan(namedPatch("m21-281", WALKERS), WALKERS, "m15pw");
    if (plan.mode !== "choose") throw new Error(plan.mode);
    expect(plan.match).toMatchObject({ status: "exact", template: "m15borderlesspwtall", landOn: "m15pw" });
    expect(plan.preselected).toEqual({ template: "m15pw" });
    expect(plan.windowCroppedNote).toBe(WINDOW_CROPPED_NOTE);
    const all = [...plan.options, ...plan.moreOptions].map((o) => o.template);
    expect(all).toContain("m15borderlesspwtall");
    expect(all).not.toContain("m15borderlesspw");
    expect(plan.heading).toBe(
      "PipGlyph has the Borderless planeswalker frame, but Scryfall's art won't fill it — pick one of these",
    );
  });

  it("Basri Ket M21 #280 (three rows): the regular one, never the tall one", () => {
    const plan = importFramePlan(namedPatch("m21-280", WALKERS), WALKERS, "m15pw");
    if (plan.mode !== "choose") throw new Error(plan.mode);
    const all = [...plan.options, ...plan.moreOptions].map((o) => o.template);
    expect(all).toContain("m15borderlesspw");
    expect(all).not.toContain("m15borderlesspwtall");
  });

  it("…and neither is offered while unverified: the import is nearest m15pw, not yet verified", () => {
    const patch = namedPatch("m21-280", STANDARD);
    expect(patch.frame_match).toMatchObject({ status: "nearest", unverified: true, template: "m15borderlesspw", landOn: "m15pw" });
    expect(patch.frame_template).toBe("m15pw");
    const plan = importFramePlan(patch, STANDARD, "m15pw");
    if (plan.mode !== "choose") throw new Error(plan.mode);
    const all = [...plan.options, ...plan.moreOptions].map((o) => o.template);
    expect(all.some((t) => t.startsWith("m15borderlesspw"))).toBe(false);
    expect(plan.preselected).toEqual({ template: "m15pw" });
  });
});

describe("importFramePlan — nearest", () => {
  it("Bident of Thassa THS #42 (2003 Nyx): the frame PipGlyph doesn't have, M15 preselected", () => {
    const plan = importFramePlan(namedPatch("ths-42", STANDARD), STANDARD, "m15");
    if (plan.mode !== "choose") throw new Error(plan.mode);
    expect(plan.heading).toBe("PipGlyph doesn't have the Nyx frame (2003) yet — pick one of these");
    expect(plan.windowCroppedNote).toBeNull();
    expect(plan.preselected).toEqual({ template: "m15" });
    expect(plan.options.map((o) => o.template)).not.toContain("nyx");
  });

  it("a frame PipGlyph has but can't dress the kind with is 'can't match', not 'doesn't have' (Replicating Ring KHM #244)", () => {
    const keys = new Set([...STANDARD, ...verified("m15snow")]);
    const plan = importFramePlan(namedPatch("khm-244", keys), keys, "m15");
    if (plan.mode !== "choose") throw new Error(plan.mode);
    expect(plan.match).toMatchObject({ status: "nearest", template: "m15snow", landOn: "m15artifact" });
    expect(plan.heading).toBe(
      "PipGlyph can't match this printing's M15 (2015) frame exactly yet — pick one of these",
    );
    expect(plan.match.reason).toMatch(/doesn't dress artifacts yet/);
    expect(plan.preselected).toEqual({ template: "m15artifact" });
  });

  it("a 2023 full-art basic (ONE #262) preselects the full-art basic, verified in white", () => {
    const plan = importFramePlan(namedPatch("one-262", WITH_BORDERLESS), WITH_BORDERLESS, "m15land");
    if (plan.mode !== "choose") throw new Error(plan.mode);
    expect(plan.preselected).toEqual({ template: "m15fullartland" });
    expect(plan.keepCurrent.available).toBe(true);
  });

  it("keeps the current frame preselected when nothing of the kind is published in the colour", () => {
    // Only the saga frame, and only in white: a multicolour saga has no option.
    const keys = new Set([frameComboKey("saga", "w"), frameComboKey("m15", "m")]);
    const plan = importFramePlan(namedPatch("tdm-383", keys), keys, "m15");
    if (plan.mode !== "choose") throw new Error(plan.mode);
    expect(plan.options).toEqual([]);
    expect(plan.preselected).toBeNull();
  });
});

describe("appliedImportFrameChoice — the creator's re-check", () => {
  const patch = () => namedPatch("dmu-435", WITH_BORDERLESS);

  it("applies a pick that still fits the imported kind and colour", () => {
    expect(
      appliedImportFrameChoice({
        choice: { template: "m15borderless" },
        patch: patch(),
        kind: "creature",
        templateBefore: "m15",
        verifiedKeys: WITH_BORDERLESS,
      }),
    ).toBe("m15borderless");
  });

  it("keep-current means the frame before the import", () => {
    expect(
      appliedImportFrameChoice({
        choice: { keepCurrent: true },
        patch: patch(),
        kind: "creature",
        templateBefore: "m15",
        verifiedKeys: WITH_BORDERLESS,
      }),
    ).toBe("m15");
  });

  it("a stale pick (unverified since, or the wrong kind) falls back (null)", () => {
    expect(
      appliedImportFrameChoice({
        choice: { template: "m15borderless" },
        patch: patch(),
        kind: "creature",
        templateBefore: "m15",
        verifiedKeys: STANDARD,
      }),
    ).toBeNull();
    expect(
      appliedImportFrameChoice({
        choice: { keepCurrent: true },
        patch: patch(),
        kind: "creature",
        templateBefore: "m15land",
        verifiedKeys: WITH_BORDERLESS,
      }),
    ).toBeNull();
    expect(
      appliedImportFrameChoice({
        choice: undefined,
        patch: patch(),
        kind: "creature",
        templateBefore: "m15",
        verifiedKeys: WITH_BORDERLESS,
      }),
    ).toBeNull();
  });
});

describe("the substitution chip and the deck-remix toast", () => {
  it("names what the printing is while the card sits on another frame", () => {
    // Borderless draws Sheoldred's crown since 4.6f: with the frame
    // unverified in black, the verification downgrade is what is left.
    const match = namedPatch("dmu-435", STANDARD).frame_match;
    expect(frameSubstitutionFor(match, "m15")).toEqual({
      exactLabel: "Borderless frame",
      template: "m15",
      reason: "not yet verified in black",
      nearestOnOwnFrame: false,
    });
    expect(importSubstitutionMessage(match, "m15")).toBe(
      "PipGlyph doesn't have the Borderless frame yet — using M15 (2015) Standard.",
    );
  });

  it("an exact borderless match landing on bordered M15 names the cropped art", () => {
    const match = namedPatch("fdn-311", WITH_BORDERLESS).frame_match;
    expect(frameSubstitutionFor(match, "m15")?.reason).toBe(
      "Scryfall's art for this printing is cropped to the bordered window",
    );
    expect(importSubstitutionMessage(match, "m15")).toBe(
      "Scryfall's art for this printing is cropped to the bordered window — using M15 (2015) Standard instead of the Borderless frame.",
    );
  });

  it("nothing on the printing's own exact frame, picked over the bordered landing (FDN #311 on Borderless)", () => {
    const match = namedPatch("fdn-311", WITH_BORDERLESS).frame_match;
    expect(match).toMatchObject({ status: "exact", template: "m15borderless", landOn: "m15" });
    expect(frameSubstitutionFor(match, "m15borderless")).toBeNull();
    expect(importSubstitutionMessage(match, "m15borderless")).toBeNull();
  });

  it("the crown on the standard frame is exact since 4.6a: no chip, no toast (Sheoldred DMU #107)", () => {
    const match = namedPatch("dmu-107", STANDARD).frame_match;
    expect(match).toMatchObject({ status: "exact", template: "m15" });
    expect(match?.gaps).toBeUndefined();
    expect(frameSubstitutionFor(match, "m15")).toBeNull();
    expect(importSubstitutionMessage(match, "m15", undefined, "b")).toBeNull();
  });

  it("a crown-only match on a frame that doesn't draw it is 'Nearest frame' and toasts (the snow frame, 4.6f)", () => {
    const match = snowLegend(new Set([...STANDARD, ...verified("m15snow")])).frame_match;
    expect(match).toMatchObject({ status: "nearest", template: "m15snow", gaps: ["crown"], blockedBy: "4.6f" });
    const substitution = frameSubstitutionFor(match, "m15snow");
    expect(substitution).toMatchObject({
      nearestOnOwnFrame: true,
      reason: "PipGlyph doesn't draw the legendary crown on this frame yet",
    });
    expect(frameSubstitutionLabel(substitution!)).toBe("Nearest frame (imported M15 (2015) frame)");
  });

  it("a colour indicator alone, or with the crown m15 draws, is quiet; a gap PipGlyph paints differently still toasts (C3)", () => {
    const indicator = indicatorOnly(STANDARD).frame_match;
    expect(indicator).toMatchObject({ status: "nearest", template: "m15", gaps: ["colour-indicator"] });
    expect(importSubstitutionMessage(indicator, "m15", undefined, "b")).toBeNull();
    const both = legendWithIndicator(STANDARD).frame_match;
    expect(both?.gaps).toEqual(["colour-indicator"]);
    expect(importSubstitutionMessage(both, "m15", undefined, "b")).toBeNull();
    // A black-red legend: m15 draws the crown (4.6a) and the two-colour
    // split (4.6b) — its own frame exactly, quiet.
    const twoColour = twoColourLegend(STANDARD).frame_match;
    expect(twoColour).toMatchObject({ status: "exact", template: "m15" });
    expect(twoColour?.gaps).toBeUndefined();
    expect(importSubstitutionMessage(twoColour, "m15", undefined, "m")).toBeNull();
    // A hybrid artifact legend: the artifact frame draws the crown but has no
    // hybrid dress — a real difference.
    const hybridArtifact = hybridArtifactLegend(STANDARD).frame_match;
    expect(hybridArtifact?.gaps).toEqual(["two-colour-hybrid"]);
    expect(importSubstitutionMessage(hybridArtifact, "m15artifact", undefined, "m")).toBe(
      "Two-colour hybrid cards print a split hybrid frame, which PipGlyph doesn't draw on this frame yet — using M15 (2015) Artifact.",
    );
  });

  it("names the cropped art, not a missing frame, when the edge-to-edge frame is published (DMU #435, exact since 4.6f)", () => {
    const match = namedPatch("dmu-435", WITH_BORDERLESS).frame_match;
    expect(match).toMatchObject({ status: "exact", template: "m15borderless", landOn: "m15" });
    expect(
      importSubstitutionMessage(match, "m15", (t) => WITH_BORDERLESS.has(frameComboKey(t, "b"))),
    ).toBe(
      "Scryfall's art for this printing is cropped to the bordered window — using M15 (2015) Standard instead of the Borderless frame.",
    );
    // …and as missing while Borderless isn't published in black (the match
    // the verification downgraded).
    const unverified = namedPatch("dmu-435", STANDARD).frame_match;
    expect(unverified).toMatchObject({ status: "nearest", template: "m15borderless", landOn: "m15" });
    expect(
      importSubstitutionMessage(unverified, "m15", (t) => STANDARD.has(frameComboKey(t, "b"))),
    ).toBe("PipGlyph doesn't have the Borderless frame yet — using M15 (2015) Standard.");
  });

  it("nothing for the exact reproduction, a refused card, or no match", () => {
    const exact = namedPatch("msc-240", STANDARD).frame_match;
    expect(frameSubstitutionFor(exact, "m15land")).toBeNull();
    expect(importSubstitutionMessage(exact, "m15land")).toBeNull();
    expect(frameSubstitutionFor(namedPatch("sznr-1", STANDARD).frame_match, "m15")).toBeNull();
    expect(frameSubstitutionFor(undefined, "m15")).toBeNull();
  });

  it("theFrame reads an exactLabel as a noun phrase", () => {
    expect(theFrame("Borderless frame")).toBe("the Borderless frame");
    expect(theFrame("Nyx frame (2003)")).toBe("the Nyx frame (2003)");
    expect(theFrame("Bloomburrow woodland showcase")).toBe("the Bloomburrow woodland showcase frame");
    expect(theFrame("The Lord of the Rings ring showcase")).toBe("The Lord of the Rings ring showcase frame");
  });
});

describe("C1 — no chooser when the only gap is a detail no frame draws (owner decision 2026-09-29)", () => {
  it("Sheoldred DMU #107 (the crown, drawn on M15 since 4.6a) lands on its own M15 frame without asking", () => {
    expect(importFramePlan(namedPatch("dmu-107", STANDARD), STANDARD, "m15")).toEqual({ mode: "none" });
  });

  it("…from any current frame, and for a colour indicator, alone or with the crown", () => {
    expect(importFramePlan(namedPatch("dmu-107", STANDARD), STANDARD, "m15land")).toEqual({
      mode: "none",
    });
    expect(importFramePlan(indicatorOnly(STANDARD), STANDARD, "m15")).toEqual({ mode: "none" });
    expect(importFramePlan(legendWithIndicator(STANDARD), STANDARD, "m15")).toEqual({ mode: "none" });
  });

  it("asks when a gap PipGlyph paints differently holds (a two-colour hybrid dress the artifact frame doesn't draw)", () => {
    const plan = importFramePlan(hybridArtifactLegend(STANDARD), STANDARD, "m15");
    if (plan.mode !== "choose") throw new Error(plan.mode);
    expect(plan.heading).toBe(
      "PipGlyph can't match this printing's M15 (2015) frame exactly yet — pick one of these",
    );
    expect(plan.preselected).toEqual({ template: "m15artifact" });
    // The black-red legend's crown and split frame are both drawn on m15
    // (4.6a / 4.6b): its own frame exactly — no chooser.
    expect(importFramePlan(twoColourLegend(STANDARD), STANDARD, "m15")).toEqual({ mode: "none" });
  });

  it("asks when the printing's own frame isn't published in its colour (a real substitution)", () => {
    const noBlack = new Set([...STANDARD].filter((key) => key !== frameComboKey("m15", "b")));
    const plan = importFramePlan(namedPatch("dmu-107", noBlack), noBlack, "m15");
    expect(plan.mode).toBe("choose");
  });

  it("asks for a crown its own frame doesn't draw, where M15 does (the snow frame, 4.6a)", () => {
    const keys = new Set([...STANDARD, ...verified("m15snow")]);
    const plan = importFramePlan(snowLegend(keys), keys, "m15");
    if (plan.mode !== "choose") throw new Error(plan.mode);
    expect(plan.preselected).toEqual({ template: "m15snow" });
    expect(plan.options.map((o) => o.template)).toContain("m15");
  });

  it("asks when an exact edge-to-edge printing can't land on its frame (Borderless → bordered M15, DMU #435; its crown is drawn since 4.6f)", () => {
    expect(importFramePlan(namedPatch("dmu-435", WITH_BORDERLESS), WITH_BORDERLESS, "m15").mode).toBe(
      "choose",
    );
  });

  it("onlyUndrawnDetailsMissing: only nearest, on its own frame, only colour-indicator, a true border", () => {
    const base = { status: "nearest" as const, template: "m15" as const, gaps: ["colour-indicator" as const] };
    expect(onlyUndrawnDetailsMissing(base, "b")).toBe(true);
    // The crown is drawn (m15 / m15artifact / m15land, 4.6a): a frame short
    // of it has a real alternative, so it is no undrawn detail any more.
    expect(onlyUndrawnDetailsMissing({ ...base, gaps: ["crown"] }, "b")).toBe(false);
    expect(onlyUndrawnDetailsMissing({ ...base, gaps: ["crown", "colour-indicator"] }, "b")).toBe(false);
    expect(onlyUndrawnDetailsMissing({ ...base, status: "exact" }, "b")).toBe(false);
    expect(onlyUndrawnDetailsMissing({ ...base, landOn: "m15artifact" }, "b")).toBe(false);
    expect(onlyUndrawnDetailsMissing({ ...base, gaps: [] }, "b")).toBe(false);
    expect(onlyUndrawnDetailsMissing({ ...base, gaps: undefined }, "b")).toBe(false);
    expect(onlyUndrawnDetailsMissing({ ...base, gaps: ["crown", "vehicle"] }, "b")).toBe(false);
    expect(onlyUndrawnDetailsMissing({ ...base, gaps: ["nyx", "crown"] }, "b")).toBe(false);
    // A frame whose border isn't true yet is a second gap (4.35 / A8).
    expect(onlyUndrawnDetailsMissing({ ...base, template: "battle" }, "w")).toBe(false);
    expect(onlyUndrawnDetailsMissing({ ...base, template: "expeditionland" }, "g")).toBe(false);
    expect(onlyUndrawnDetailsMissing({ ...base, template: "expeditionland" }, "r")).toBe(true);
    expect(onlyUndrawnDetailsMissing(undefined, "b")).toBe(false);
  });
});

describe("C2 — the standard frame and the printing's family first, the rest behind Show all frames", () => {
  const templates = (options: readonly { template: string }[]) => options.map((o) => o.template);

  it("Sheoldred DMU #435: M15 and Borderless first; Snow, Devoid, the older eras and the showcases behind the link", () => {
    const plan = importFramePlan(namedPatch("dmu-435", EVERYTHING), EVERYTHING, "m15");
    if (plan.mode !== "choose") throw new Error(plan.mode);
    expect(templates(plan.options)).toEqual(["m15", "m15borderless"]);
    const more = templates(plan.moreOptions);
    expect(more).toEqual(expect.arrayContaining(["m15snow", "m15devoid", "agclassic", "retro", "modern", "bloomburrow"]));
    // Gallery order: the border eras oldest first, then the showcases.
    expect(more.indexOf("agclassic")).toBeLessThan(more.indexOf("modern"));
    expect(more.indexOf("m15devoid")).toBeLessThan(more.indexOf("bloomburrow"));
    // Never a frame the card can't wear: the artifact dress, Nyx, a basic-only frame.
    expect(more).not.toContain("m15artifact");
    expect(more).not.toContain("m15borderlessartifact");
    expect(more).not.toContain("nyx");
    expect(more).not.toContain("fullartland");
    // Nothing twice.
    expect(new Set([...templates(plan.options), ...more]).size).toBe(plan.options.length + more.length);
  });

  it("a showcase printing lists its own set's frames (Bloomburrow anime BLB #343: woodland beside it)", () => {
    const plan = importFramePlan(namedPatch("blb-343", EVERYTHING), EVERYTHING, "m15");
    if (plan.mode !== "choose") throw new Error(plan.mode);
    expect(templates(plan.options)).toEqual(["bloomanime", "m15", "bloomburrow"]);
    expect(templates(plan.moreOptions)).not.toContain("bloomanime");
  });

  it("a full-art basic lists the full-art basics, not the textless frames (ONE #262)", () => {
    const plan = importFramePlan(namedPatch("one-262", EVERYTHING), EVERYTHING, "m15land");
    if (plan.mode !== "choose") throw new Error(plan.mode);
    expect(templates(plan.options)).toEqual(["m15fullartland", "m15land", "fullartland"]);
    expect(templates(plan.moreOptions)).toEqual(expect.arrayContaining(["m15textlessland"]));
  });

  it("a snow printing's family is its own Snow skin beside the standard; a plain one's isn't", () => {
    const khm = importFramePlan(namedPatch("khm-244", EVERYTHING), EVERYTHING, "m15");
    if (khm.mode !== "choose") throw new Error(khm.mode);
    // KHM #244 is an ARTIFACT: the snow frame can't dress the kind, so only
    // the artifact standard is first.
    expect(templates(khm.options)).toEqual(["m15artifact"]);
    const thb = importFramePlan(namedPatch("thb-18", EVERYTHING), EVERYTHING, "m15");
    if (thb.mode !== "choose") throw new Error(thb.mode);
    expect(templates(thb.options)).toEqual(["m15"]);
    // An Enchantment Creature may wear Nyx (A3) — among the other frames.
    expect(templates(thb.moreOptions)).toContain("nyx");
  });

  it("with nothing of the family or the standard published, every published frame is shown", () => {
    const keys = verified("retro");
    const plan = importFramePlan(namedPatch("dmu-435", keys), keys, "m15");
    if (plan.mode !== "choose") throw new Error(plan.mode);
    expect(templates(plan.options)).toEqual(["retro"]);
    expect(plan.moreOptions).toEqual([]);
  });

  it("the nearest stays preselected and first", () => {
    const plan = importFramePlan(namedPatch("fra-382", EVERYTHING), EVERYTHING, "m15");
    if (plan.mode !== "choose") throw new Error(plan.mode);
    expect(plan.preselected).toEqual({ template: "m15land" });
    expect(plan.options[0]).toMatchObject({ template: "m15land", nearest: true });
    expect(templates(plan.options)).toEqual(["m15land", "fullartland", "m15fullartland"]);
  });
});

describe("A3 — the chooser dresses an Enchantment Creature in Nyx, never a plain creature", () => {
  it("offers Nyx to a THB god and applies it", () => {
    const keys = new Set([...STANDARD, frameComboKey("nyx", "w")]);
    const patch = namedPatch("thb-18", keys);
    const plan = importFramePlan(patch, keys, "m15");
    if (plan.mode !== "choose") throw new Error(plan.mode);
    expect([...plan.options, ...plan.moreOptions].map((o) => o.template)).toContain("nyx");
    expect(
      appliedImportFrameChoice({
        choice: { template: "nyx" },
        patch,
        kind: "creature",
        templateBefore: "m15",
        verifiedKeys: keys,
      }),
    ).toBe("nyx");
  });

  it("refuses Nyx for a creature that isn't an enchantment", () => {
    const keys = new Set([...STANDARD, frameComboKey("nyx", "b"), frameComboKey("nyx", "m")]);
    const plan = importFramePlan(hybridArtifactLegend(keys), keys, "m15");
    if (plan.mode !== "choose") throw new Error(plan.mode);
    expect([...plan.options, ...plan.moreOptions].map((o) => o.template)).not.toContain("nyx");
    expect(
      appliedImportFrameChoice({
        choice: { template: "nyx" },
        patch: namedPatch("dmu-107", keys),
        kind: "creature",
        templateBefore: "m15",
        verifiedKeys: keys,
      }),
    ).toBeNull();
  });
});
