import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import printingsData from "../cards/fixtures/reference-printings.json";
import { frameComboKey, FRAME_COLOR_KEYS } from "@/lib/cards/frame-reference-registry";
import { finalizeImportMatch } from "@/lib/creator/frame-resolve";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import { mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import { PIPGLYPH_ROSE_WATERMARK } from "@/lib/cards/watermark";
import type { FrameTemplate } from "@/types/card";
import {
  DEFAULT_BULK_CHOICES,
  type BulkChoices,
} from "@/lib/tools/bulk-customize/model";
import {
  effectiveWatermark,
  lookTemplateFor,
  planCustomizedCard,
  printingSetSymbolCode,
} from "@/lib/tools/bulk-customize/planner";

// ---------------------------------------------------------------------------
// The Bulk Customize planner on REAL printings (the reference fixture) and
// production's verified combos (supabase/seed.sql mirrors them): what each
// card saves as, the per-card fall-backs, and the exact-copy rule — a card
// the choices leave unchanged is never planned for a save.
// ---------------------------------------------------------------------------

const printings = Object.values(printingsData as Record<string, { name: string; set: string }>);
const printing = (name: string, set: string) => {
  const found = printings.find((card) => card.name === name && card.set === set);
  if (!found) throw new Error(`no captured printing ${name} (${set})`);
  return scryfallCardSchema.parse(found);
};

function productionVerifiedKeys(): Set<string> {
  const sql = readFileSync(join(process.cwd(), "supabase/seed.sql"), "utf8");
  const block = /-- frame_reviews:begin\n([\s\S]*?)-- frame_reviews:end/.exec(sql)?.[1].replace(/--.*$/gm, "");
  if (!block) throw new Error("frame_reviews block missing from seed.sql");
  const everyColour = /unnest\(array\[([^\]]*)\]\)\s+as t/.exec(block)?.[1] ?? "";
  const out = new Set<string>();
  for (const [, template] of everyColour.matchAll(/'([^']+)'/g)) {
    for (const colour of FRAME_COLOR_KEYS) out.add(frameComboKey(template as FrameTemplate, colour));
  }
  for (const [, template, colour] of block.matchAll(/\('([^']+)',\s*'([wubrgcm])',\s*true/g)) {
    out.add(frameComboKey(template as FrameTemplate, colour));
  }
  return out;
}
const VERIFIED = productionVerifiedKeys();

function plan(name: string, set: string, choices: Partial<BulkChoices>, opts: { removeWatermark?: boolean; verified?: Set<string> } = {}) {
  const card = printing(name, set);
  const verified = opts.verified ?? VERIFIED;
  const mapped = mapScryfallToFormPatch(card, {});
  const patch = mapped.frame_match ? finalizeImportMatch(mapped, verified) : mapped;
  return planCustomizedCard({
    patch,
    fallbackTitle: card.name,
    scryfallSet: card.set,
    choices: { ...DEFAULT_BULK_CHOICES, ...choices },
    verifiedKeys: verified,
    removeWatermark: opts.removeWatermark ?? true,
  });
}

describe("planCustomizedCard — exact copies", () => {
  it("leaves a card out when nothing would change (keep everything)", () => {
    const result = plan("Llanowar Elves", "dom", {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unchanged");
  });

  it("art kept or added later is no change by itself", () => {
    for (const art of ["keep", "later"] as const) {
      const result = plan("Shock", "m21", { art });
      expect(result.ok).toBe(false);
    }
  });

  it("a white border on a frame that draws none is no change", () => {
    const result = plan("Shock", "m21", { border: "white" });
    expect(result.ok).toBe(false);
  });

  it("a free account's watermark pick on a creature still carries the Rose, so it changes nothing", () => {
    const result = plan("Llanowar Elves", "dom", { watermark: "tide-crest" }, { removeWatermark: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/PipGlyph Rose/);
  });
});

describe("planCustomizedCard — the look", () => {
  it("dresses a 2015 creature in the 1997 frame where it's verified", () => {
    const result = plan("Llanowar Elves", "dom", { look: "retro" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.frame_style.template).toBe("retro");
    expect(result.changes).toContain("frame");
    expect(result.payload.import_unchanged).toBe(false);
    expect(result.payload.source_scryfall_id).toBeTruthy();
  });

  it("puts a white border on only where the frame draws one", () => {
    const result = plan("Llanowar Elves", "dom", { look: "retro", border: "white" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.frame_style.border).toBe("white");
    expect(result.changes).toEqual(expect.arrayContaining(["frame", "border"]));
  });

  it("keeps the printing's frame with a note when the look's frame isn't verified", () => {
    // Every combo but the 1997 frame's (frameComboKey: "<template>/<colour>").
    const verified = new Set([...VERIFIED].filter((key) => !key.startsWith("retro/")));
    const result = plan("Llanowar Elves", "dom", { look: "retro", setSymbol: "printing" }, { verified });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.frame_style.template).not.toBe("retro");
    expect(result.changes).not.toContain("frame");
    expect(result.notes.join(" ")).toMatch(/Kept its printing's frame/);
  });

  it("never re-frames a two-part card", () => {
    const result = plan("Commit // Memory", "akh", { look: "retro" });
    if (result.ok) expect(result.changes).not.toContain("frame");
    else expect(result.reason).toBe("unchanged");
  });

  it("names the frame each look gives a card type", () => {
    expect(lookTemplateFor("borderless", "land", undefined, "m15land")).toBe("m15borderlessland");
    expect(lookTemplateFor("borderless", "creature", "Artifact", "m15artifact")).toBe("m15borderlessartifact");
    expect(lookTemplateFor("extended", "planeswalker", undefined, "m15pw")).toBeNull();
    expect(lookTemplateFor("m15", "creature", undefined, "m15nyx")).toBe("m15nyx");
  });
});

describe("planCustomizedCard — set symbol, watermark, art", () => {
  it("draws the printing's own set symbol where PipGlyph has its glyph", () => {
    expect(printingSetSymbolCode("dom")).toBe("dom");
    expect(printingSetSymbolCode("not-a-set")).toBeNull();
    const result = plan("Llanowar Elves", "dom", { setSymbol: "printing" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.set_icon_code).toBe("dom");
  });

  it("a paid account's watermark pick is a change", () => {
    const result = plan("Llanowar Elves", "dom", { watermark: "tide-crest" }, { removeWatermark: true });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.watermark).toEqual({ kind: "preset", key: "tide-crest", size: "normal" });
  });

  it("a free account's creature always carries the Rose", () => {
    expect(effectiveWatermark("none", "creature", false)).toEqual(PIPGLYPH_ROSE_WATERMARK);
    expect(effectiveWatermark("none", "creature", true)).toBeNull();
    expect(effectiveWatermark("none", "land", false)).toBeNull();
  });

  it("prices AI art at one credit a face, with no real artist's credit", () => {
    const ai = plan("Shock", "m21", { art: "ai" });
    expect(ai.ok).toBe(true);
    if (!ai.ok) return;
    expect(ai.credits).toBe(1);
    expect(ai.changes).toContain("ai_art");
    expect(ai.payload.artist_credit).toBeUndefined();

    const kept = plan("Shock", "m21", { look: "retro" });
    if (kept.ok) expect(kept.credits).toBe(0);
  });

  it("saves a card whose art comes later private, whatever the visibility", () => {
    const result = plan("Llanowar Elves", "dom", { look: "retro", art: "later", visibility: "public" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.visibility).toBe("private");
  });
});
