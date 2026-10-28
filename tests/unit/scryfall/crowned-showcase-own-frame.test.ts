import { describe, expect, it } from "vitest";
import anatomyPrintings from "./fixtures/anatomy-printings.json";
import signaturePrintings from "./fixtures/signature-printings.json";
import showcasePrintings from "./fixtures/showcase-signature-printings.json";
import nyxPrintings from "./fixtures/nyx-nearest-printings.json";
import dossierPrintings from "./fixtures/mkm-dossier-printings.json";
import stainedGlassPrintings from "./fixtures/stained-glass-printings.json";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import { mapScryfallToFormPatch, ownCrownFramesOf } from "@/lib/scryfall/import-mapper";
import { FRAME_SIGNATURE_RULES, ownFramesOfSignature } from "@/lib/scryfall/frame-signatures";
import { importedAnatomy } from "@/lib/cards/anatomy";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { FRAME_COLOR_KEYS } from "@/lib/creator/card-kinds";
import { finalizeImportMatch, resolveImportFrame } from "@/lib/creator/frame-resolve";
import { importFramePlan, importedKindOf } from "@/lib/creator/import-frame-choice";
import { FRAME_TEMPLATE_VALUES, type FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// A crowned showcase's crown is its OWN frame's (TODO 4.11; the owner's rule
// from the Bloomburrow anime, layout v70, made the rule for every crowned
// showcase with the Dominaria United stained glass): an import of one of its
// legends turns the crown switch ON only where the card lands on — or is
// switched to — the frame the signature's rule names. On the standard frame
// an unverified combo falls back to, the printing wears no standard crown:
// OFF. The frames are read from the registry (ownFramesOfSignature), never
// listed by hand. Before this rule only the anime was held to it; the other
// crowned showcases drew M15's standard crown on their fallback landing. The
// one exception: the Theros constellation, whose crown IS the standard 2015
// crown (starfield inside) — owner Round 59 read M15's crown on its fallback
// as fine, so it still follows the printing onto any landing.
// ---------------------------------------------------------------------------

const fixtures = {
  ...anatomyPrintings,
  ...signaturePrintings,
  ...showcasePrintings,
  ...nyxPrintings,
  ...dossierPrintings,
  ...stainedGlassPrintings,
} as Record<string, unknown>;
const card = (key: string) => scryfallCardSchema.parse(fixtures[key]);

const ALL = new Set(FRAME_TEMPLATE_VALUES.flatMap((t) => FRAME_COLOR_KEYS.map((k) => frameComboKey(t, k))));
const without = (template: FrameTemplate) => new Set([...ALL].filter((key) => !FRAME_COLOR_KEYS.some((k) => key === frameComboKey(template, k))));

/** One legend per crowned showcase the fixtures hold (the ZNR hedron's and
 *  the BLB woodland's legends are not captured: the registry test below
 *  covers their frames). */
const LEGENDS: readonly [key: string, signature: string, own: FrameTemplate][] = [
  ["ltr-302", "showcase/ltr/ring", "lotr"],
  ["ltr-321", "showcase/ltr/ring+two-colour", "lotr"],
  ["ltc-411", "showcase/ltr/scroll", "lotrscroll"],
  ["mkm-337", "showcase/mkm/dossier", "dossier"],
  ["mul-1", "showcase/mul/tarkir", "tarkirdragon"],
  ["mul-5", "showcase/dmu/stained-glass", "stainedglass"],
  ["dmu-287", "showcase/dmu/stained-glass", "stainedglass"],
  ["dmu-310", "showcase/dmu/stained-glass", "stainedglass"],
];

function importOf(key: string, verified: ReadonlySet<string>) {
  const patch = finalizeImportMatch(mapScryfallToFormPatch(card(key)), verified);
  const kind = importedKindOf(patch);
  if (!kind) throw new Error(`${key}: no kind`);
  const { resolution } = resolveImportFrame({
    patch,
    kind,
    current: { template: "m15", cardType: patch.card_type ?? null, colors: patch.color_identity ?? [] },
    verifiedKeys: verified,
  });
  // The creator's rule (card-creator-form): an exact or switched landing
  // takes its frame, anything else keeps the current one.
  const landed = resolution.status === "exact" || resolution.status === "frame-switched" ? resolution.template : "m15";
  return { patch, resolution, landed, crown: importedAnatomy(patch, landed).style.crown };
}

describe("a crowned showcase's crown is its own frame's", () => {
  it("every crowned signature names its own frame in the registry (derived, never listed twice)", () => {
    const crowned = FRAME_SIGNATURE_RULES.map((rule) => rule.key).filter((key) => ownCrownFramesOf(key) !== undefined);
    expect(crowned.sort()).toEqual(
      [
        "showcase/blb/anime",
        "showcase/blb/woodland",
        "showcase/blb/woodland+two-colour",
        "showcase/blb/woodland+two-colour-hybrid",
        "showcase/dmu/stained-glass",
        "showcase/ltr/ring",
        "showcase/ltr/ring+two-colour",
        "showcase/ltr/ring+two-colour-hybrid",
        "showcase/ltr/scroll",
        "showcase/ltr/scroll+two-colour",
        "showcase/ltr/scroll+two-colour-hybrid",
        "showcase/mkm/dossier",
        "showcase/mul/tarkir",
        "showcase/snc/art-deco",
        "showcase/znr/hedron",
      ].sort(),
    );
    for (const signature of crowned) expect(ownCrownFramesOf(signature), signature).toEqual(ownFramesOfSignature(signature));
    expect(ownCrownFramesOf("showcase/blb/anime")).toEqual(["bloomanime"]);
    expect(ownCrownFramesOf("showcase/znr/hedron")).toEqual(["fullart"]);
    expect(ownCrownFramesOf("showcase/blb/woodland+two-colour")).toEqual(["bloomburrow"]);
    // The New Capenna Art Deco's arch (#622 listed it by hand): derived the same.
    expect(ownCrownFramesOf("showcase/snc/art-deco")).toEqual(["sncartdeco"]);
    // A printing that isn't a crowned showcase names no own frame: its
    // standard crown follows it wherever it lands.
    expect(ownCrownFramesOf("era/2015")).toBeUndefined();
    expect(ownCrownFramesOf("showcase/thb/constellation")).toBeUndefined();
    expect(mapScryfallToFormPatch(card("dmu-287")).printed_crown_frames).toEqual(["stainedglass"]);
  });

  it.each(LEGENDS)("%s (%s): unverified, it lands on the standard frame with the crown OFF", (key, signature, own) => {
    const { patch, resolution, landed, crown } = importOf(key, without(own));
    expect(patch.frame_match?.signature).toBe(signature);
    expect(patch.printed_crown).toBe(true);
    expect(resolution.status).toBe("frame-switched");
    expect(landed).not.toBe(own);
    expect(landed.startsWith("m15")).toBe(true);
    expect(crown).toBe(false);
    // …and with nothing verified at all (the import keeps the current m15).
    expect(importOf(key, new Set()).crown).toBe(false);
  });

  it.each(LEGENDS)("%s (%s): verified, it lands on its own frame with the crown ON", (key, _signature, own) => {
    const { landed, crown } = importOf(key, ALL);
    expect(landed).toBe(own);
    expect(crown).toBe(true);
  });

  it.each(LEGENDS)("%s (%s): picking the showcase in the chooser turns the crown ON", (key, _signature, own) => {
    // The chooser's tiles and its pick store importedAnatomy(printing,
    // picked frame) — components/creator/import/frame-chooser.tsx.
    const { patch } = importOf(key, without(own));
    expect(importedAnatomy(patch, own).style.crown).toBe(true);
    expect(importedAnatomy(patch, "m15").style.crown).toBe(false);
  });

  it("a two-colour ring legend: verified, its nearest landing is its own frame and the chooser offers it, crown on", () => {
    const { patch, landed, crown } = importOf("ltr-321", ALL);
    expect(patch.frame_match?.status).toBe("nearest");
    expect([landed, crown]).toEqual(["lotr", true]);
    const plan = importFramePlan(patch, ALL, "m15");
    expect(plan.mode).toBe("choose");
    if (plan.mode !== "choose") return;
    expect(plan.options.map((o) => o.template)).toContain("lotr");
  });

  it.each(["thb-259", "mul-2"])("%s, the constellation: its standard crown follows it — ON on the M15 fallback (owner Round 59) and on its own frame", (key) => {
    const fallback = importOf(key, without("nyx"));
    expect(fallback.patch.frame_match?.signature).toBe("showcase/thb/constellation");
    expect(fallback.patch.printed_crown_frames).toBeUndefined();
    expect([fallback.resolution.status, fallback.landed, fallback.crown]).toEqual(["frame-switched", "m15", true]);
    const own = importOf(key, ALL);
    expect([own.landed, own.crown]).toEqual(["nyx", true]);
  });

  it("the Bloomburrow anime is unchanged: off on its standard landing, on when the anime frame is picked", () => {
    for (const verified of [ALL, without("bloomanime"), new Set<string>()]) {
      const { landed, crown } = importOf("blb-343", verified);
      expect(landed).toBe("m15");
      expect(crown).toBe(false);
    }
    const plan = importFramePlan(importOf("blb-343", ALL).patch, ALL, "m15");
    expect(plan.mode === "choose" && plan.options.map((o) => o.template)).toEqual(["m15", "bloomanime", "bloomburrow"]);
    expect(importedAnatomy(importOf("blb-343", ALL).patch, "bloomanime").style.crown).toBe(true);
  });
});
