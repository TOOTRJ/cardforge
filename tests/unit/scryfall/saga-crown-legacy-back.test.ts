import { describe, expect, it } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { frameAnatomyOf, importedAnatomy, importedFormAnatomy, newCardFrameStyle } from "@/lib/cards/anatomy";
import { crownKeyFor } from "@/lib/cards/crown";
import { backPreviewData } from "@/lib/cards/faces";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { finalizeImportMatch } from "@/lib/creator/frame-resolve";
import { scryfallCardSchema, type ScryfallCard } from "@/lib/scryfall/client";
import { mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";
import printings from "./fixtures/saga-dfc-printings.json";

// ---------------------------------------------------------------------------
// TODO 4.6f (the saga family, owner 2026-11-25): a KNOWN EFFECT, pinned so a
// later change to it is deliberate. TLA's legendary transforming sagas (TLA
// #27 / #61 / #145 / #186, their `ptla` stamps and the borderless #354–358:
// a non-legendary Saga front, a colourless "Legendary Creature — Avatar"
// back) land on the PLAIN saga frame, `nearest` (the `dfc/colourless-face`
// rule, 5.11), with the back as a LEGACY back — drawn on the front's frame
// with the front's switches (lib/cards/faces.ts backPreviewData). The import
// names the crown from the printing's `legendary` frame effect
// (printsStandardCrown), which describes the BACK; since the saga frame
// draws a crown, the save keeps `crown: true` where main dropped it. So:
//   • the front (Enchantment — Saga, not legendary) draws no crown;
//   • the legacy back (Legendary Creature) draws the saga crown in the
//     front's colour on the back-face preview and `?face=back`.
// Print does crown that back, on another body (the transform back). New
// imports only: a stored card keeps its frame_style. The alternative (not
// built): key the import's crown switch on the FRONT face's type line.
// ---------------------------------------------------------------------------

const KEYS = ["w", "u", "b", "r", "g", "c", "m"];
const ALL = new Set(FRAME_TEMPLATE_VALUES.flatMap((t) => KEYS.map((k) => frameComboKey(t, k))));
const card = scryfallCardSchema.parse((printings as Record<string, unknown>)["tla-27"]) as ScryfallCard;

describe("TLA #27 The Legend of Yangchen: the crown lands on the saga frame and is drawn on its legacy back only", () => {
  const patch = finalizeImportMatch(mapScryfallToFormPatch(card, { artPreviewUrl: null }) as never, ALL) as Record<string, unknown> & {
    frame_match: { status: string; template: string; signature: string; landOn?: string };
    back_face: Record<string, unknown>;
  };
  // The frame the creator lands the import on: its own template, else the
  // rule's landing (`landOn`), else the rule's template.
  const template = String(patch.frame_template ?? patch.frame_match.landOn ?? patch.frame_match.template);
  const imported = importedAnatomy(patch as never, template);
  const style = newCardFrameStyle({ template, ...importedFormAnatomy(imported.style) } as never, patch.card_type as string, imported.colorIdentity ?? (patch.color_identity as never));
  const front = {
    title: patch.title,
    cost: patch.cost,
    cardType: patch.card_type,
    supertype: patch.supertype ?? null,
    colorIdentity: imported.colorIdentity ?? patch.color_identity,
    frameStyle: style,
    backFace: patch.back_face,
  } as unknown as CardPreviewData;

  it("lands on the plain saga frame, nearest, its back a legacy back (no body)", () => {
    expect(card.set).toBe("tla");
    expect(card.collector_number).toBe("27");
    // The double-faced saga front is the printing's own frame; its colourless
    // Avatar back keeps it off it (5.11): it lands on the plain saga.
    expect(patch.frame_match).toMatchObject({ status: "nearest", signature: "dfc/colourless-face", template: "sagadfcfront", landOn: "saga" });
    expect(patch.frame_template).toBeUndefined();
    expect(template).toBe("saga");
    expect(frameAnatomyOf("saga").crown).toBe(true);
    expect((patch.back_face.frame_style as { template?: string } | undefined)?.template).toBeUndefined();
  });

  it("keeps crown: true (the printing's `legendary` effect) — the front draws none, the legacy back draws the saga crown in the front's colour", () => {
    expect(patch.printed_crown).toBe(true);
    expect(style).toMatchObject({ template: "saga", crown: true });
    // The front: "Enchantment — Saga", not legendary.
    expect(front.supertype ?? "").not.toMatch(/Legendary/);
    expect(crownKeyFor({ ...front, colorIdentity: front.colorIdentity }, getFrameProfile("saga"))).toBeNull();
    // The legacy back: "Legendary Creature — Avatar", on the front's frame
    // and colour, with the front's switches.
    const back = backPreviewData(front)!;
    expect(back.frameStyle).toMatchObject({ template: "saga", crown: true });
    expect(back.supertype).toMatch(/Legendary/);
    expect(crownKeyFor({ ...back, colorIdentity: back.colorIdentity }, getFrameProfile("saga"))).toBe("w");
  });
});
