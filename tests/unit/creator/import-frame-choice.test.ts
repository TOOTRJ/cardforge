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
// no chooser (and no deck pre-fill toast) for a printing short of only the
// crown or a colour indicator on its own frame (C1 / C3); the standard frame
// and the printing's family first, the rest behind "Show all frames" (C2).
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
 *  AND the two-colour split frame PipGlyph paints gold. */
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
/** …legendary with a colour-indicator dot: two details, both undrawn. */
const legendWithIndicator = (keys: ReadonlySet<string>) =>
  variantPatch("dmu-107", { color_indicator: ["B"] }, keys);

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
  it("Sheoldred DMU #435: M15 preselected with the window-cropped note; Borderless listed once verified in black", () => {
    const plan = importFramePlan(namedPatch("dmu-435", WITH_BORDERLESS), WITH_BORDERLESS, "m15");
    if (plan.mode !== "choose") throw new Error(plan.mode);
    expect(plan.preselected).toEqual({ template: "m15" });
    expect(plan.windowCroppedNote).toBe(WINDOW_CROPPED_NOTE);
    expect(plan.options.map((o) => o.template)).toEqual(["m15", "m15borderless"]);
    expect(plan.options[0]).toMatchObject({ nearest: true, edgeToEdge: false });
    expect(plan.options[1]).toMatchObject({ nearest: false, edgeToEdge: true });
    // The crown is the missing detail (4.6); PipGlyph HAS the Borderless frame.
    expect(plan.heading).toBe(
      "PipGlyph can't match this printing's Borderless frame exactly yet — pick one of these",
    );
    expect(plan.match.reason).toBe("PipGlyph doesn't draw the legendary crown yet");
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
    const match = namedPatch("dmu-435", STANDARD).frame_match;
    expect(frameSubstitutionFor(match, "m15")).toEqual({
      exactLabel: "Borderless frame",
      template: "m15",
      reason: "PipGlyph doesn't draw the legendary crown yet",
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

  it("a crown-only match on its own frame is 'Nearest frame' with no toast (Sheoldred DMU #107, C3)", () => {
    const match = namedPatch("dmu-107", STANDARD).frame_match;
    expect(match).toMatchObject({ status: "nearest", template: "m15", gaps: ["crown"] });
    const substitution = frameSubstitutionFor(match, "m15");
    expect(substitution).toMatchObject({
      nearestOnOwnFrame: true,
      reason: "PipGlyph doesn't draw the legendary crown yet",
    });
    expect(frameSubstitutionLabel(substitution!)).toBe("Nearest frame (imported M15 (2015) frame)");
    // No substitution happened: the deck pre-fill stays quiet (C3).
    expect(importSubstitutionMessage(match, "m15", undefined, "b")).toBeNull();
    // Another frame picked instead: that IS a substitution, and it says so.
    const swapped = frameSubstitutionFor(match, "m15snow");
    expect(frameSubstitutionLabel(swapped!)).toBe("Frame substituted (imported M15 (2015) frame)");
    expect(importSubstitutionMessage(match, "m15snow", undefined, "b")).toBe(
      "PipGlyph doesn't have the M15 (2015) frame yet — using M15 (2015) Snow.",
    );
  });

  it("a colour indicator alone, or with the crown, is quiet too; a second gap PipGlyph paints differently still toasts (C3)", () => {
    const indicator = indicatorOnly(STANDARD).frame_match;
    expect(indicator).toMatchObject({ status: "nearest", template: "m15", gaps: ["colour-indicator"] });
    expect(importSubstitutionMessage(indicator, "m15", undefined, "b")).toBeNull();
    const both = legendWithIndicator(STANDARD).frame_match;
    expect(both?.gaps).toEqual(["crown", "colour-indicator"]);
    expect(importSubstitutionMessage(both, "m15", undefined, "b")).toBeNull();
    // The crown and the gold frame for a black-red split: a real difference.
    const twoColour = twoColourLegend(STANDARD).frame_match;
    expect(twoColour?.gaps).toEqual(["crown", "two-colour"]);
    expect(importSubstitutionMessage(twoColour, "m15", undefined, "m")).toBe(
      "PipGlyph doesn't draw the legendary crown yet — using M15 (2015) Standard.",
    );
  });

  it("names the cropped art, not a missing frame, when a nearest edge-to-edge frame is published (DMU #435)", () => {
    const match = namedPatch("dmu-435", WITH_BORDERLESS).frame_match;
    expect(match).toMatchObject({ status: "nearest", template: "m15borderless", landOn: "m15" });
    expect(
      importSubstitutionMessage(match, "m15", (t) => WITH_BORDERLESS.has(frameComboKey(t, "b"))),
    ).toBe(
      "Scryfall's art for this printing is cropped to the bordered window — using M15 (2015) Standard instead of the Borderless frame.",
    );
    // …and as missing while Borderless isn't published in black.
    expect(
      importSubstitutionMessage(match, "m15", (t) => STANDARD.has(frameComboKey(t, "b"))),
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
  it("Sheoldred DMU #107 (the crown) lands on its own M15 frame without asking", () => {
    expect(importFramePlan(namedPatch("dmu-107", STANDARD), STANDARD, "m15")).toEqual({ mode: "none" });
  });

  it("…from any current frame, and for a colour indicator, alone or with the crown", () => {
    expect(importFramePlan(namedPatch("dmu-107", STANDARD), STANDARD, "m15land")).toEqual({
      mode: "none",
    });
    expect(importFramePlan(indicatorOnly(STANDARD), STANDARD, "m15")).toEqual({ mode: "none" });
    expect(importFramePlan(legendWithIndicator(STANDARD), STANDARD, "m15")).toEqual({ mode: "none" });
  });

  it("asks when a second gap holds (the crown and the two-colour split frame)", () => {
    const plan = importFramePlan(twoColourLegend(STANDARD), STANDARD, "m15");
    if (plan.mode !== "choose") throw new Error(plan.mode);
    expect(plan.heading).toBe(
      "PipGlyph can't match this printing's M15 (2015) frame exactly yet — pick one of these",
    );
    expect(plan.preselected).toEqual({ template: "m15" });
  });

  it("asks when the printing's own frame isn't published in its colour (a real substitution)", () => {
    const noBlack = new Set([...STANDARD].filter((key) => key !== frameComboKey("m15", "b")));
    const plan = importFramePlan(namedPatch("dmu-107", noBlack), noBlack, "m15");
    expect(plan.mode).toBe("choose");
  });

  it("asks when the crown sits on a frame the import can't land on (Borderless → bordered M15, DMU #435)", () => {
    expect(importFramePlan(namedPatch("dmu-435", WITH_BORDERLESS), WITH_BORDERLESS, "m15").mode).toBe(
      "choose",
    );
  });

  it("onlyUndrawnDetailsMissing: only nearest, on its own frame, only crown / colour-indicator, a true border", () => {
    const base = { status: "nearest" as const, template: "m15" as const, gaps: ["crown" as const] };
    expect(onlyUndrawnDetailsMissing(base, "b")).toBe(true);
    expect(onlyUndrawnDetailsMissing({ ...base, gaps: ["colour-indicator"] }, "b")).toBe(true);
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
    const keys = new Set([...STANDARD, frameComboKey("nyx", "b")]);
    const plan = importFramePlan(twoColourLegend(keys), keys, "m15");
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
