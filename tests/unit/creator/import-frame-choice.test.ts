import { describe, expect, it } from "vitest";
import signaturePrintings from "../scryfall/fixtures/signature-printings.json";
import treatmentPrintings from "../scryfall/fixtures/treatment-printings.json";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import {
  mapScryfallToFormPatch,
  verifiedFrameMatchFromScryfall,
  type ScryfallImportPatch,
} from "@/lib/scryfall/import-mapper";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import {
  appliedImportFrameChoice,
  frameSubstitutionFor,
  importFramePlan,
  importSubstitutionMessage,
  theFrame,
  WINDOW_CROPPED_NOTE,
} from "@/lib/creator/import-frame-choice";

// ---------------------------------------------------------------------------
// TODO 1.5's frame chooser, as a pure plan over real (trimmed) Scryfall
// printings run through the real mapper and the route's verification step:
// when it shows, what it offers in the imported colour, what it preselects
// (resolveImportFrame's landing — 1.18's bordered M15 for a borderless
// printing), "keep my current frame", a substitute card's refusal, and the
// creator's re-check when it applies the pick.
// ---------------------------------------------------------------------------

const fixtures = { ...signaturePrintings, ...treatmentPrintings } as Record<string, unknown>;
const EVERY_COLOUR = ["w", "u", "b", "r", "g", "c", "m"];
const verified = (...templates: string[]) =>
  new Set(templates.flatMap((t) => EVERY_COLOUR.map((k) => frameComboKey(t, k))));

/** The /api/scryfall/named patch: the mapper's, with the match finalized. */
function namedPatch(key: string, keys: ReadonlySet<string>): ScryfallImportPatch {
  const card = scryfallCardSchema.parse(fixtures[key]);
  const patch = mapScryfallToFormPatch(card);
  patch.frame_match = verifiedFrameMatchFromScryfall(card, keys, patch.frame_match);
  return patch;
}

const STANDARD = verified("m15", "m15artifact", "m15land", "m15pw", "m15token", "saga");
const WITH_BORDERLESS = new Set([...STANDARD, ...verified("m15borderless", "m15fullartland")]);

describe("importFramePlan — when the chooser shows", () => {
  it("an exact printing imports without asking (Evolving Wilds MSC #240, a Cat token)", () => {
    expect(importFramePlan(namedPatch("msc-240", STANDARD), STANDARD, "m15")).toEqual({ mode: "none" });
    expect(importFramePlan(namedPatch("t2xm-4", STANDARD), STANDARD, "m15")).toEqual({ mode: "none" });
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

describe("importFramePlan — nearest", () => {
  it("Bident of Thassa THS #42 (2003 Nyx): the frame PipGlyph doesn't have, M15 preselected", () => {
    const plan = importFramePlan(namedPatch("ths-42", STANDARD), STANDARD, "m15");
    if (plan.mode !== "choose") throw new Error(plan.mode);
    expect(plan.heading).toBe("PipGlyph doesn't have the Nyx frame (2003) yet — pick one of these");
    expect(plan.windowCroppedNote).toBeNull();
    expect(plan.preselected).toEqual({ template: "m15" });
    expect(plan.options.map((o) => o.template)).not.toContain("nyx");
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
