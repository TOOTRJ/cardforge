import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import signaturePrintings from "../scryfall/fixtures/signature-printings.json";
import importPrintings from "../scryfall/fixtures/import-printings.json";
import type { ScryfallCard } from "@/lib/scryfall/client";
import { mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { FRAME_SIGNATURE_KEYS } from "@/lib/scryfall/frame-signatures";
import {
  artFlagForImport,
  frameRequestFromImport,
  frameRequestSchema,
  isForGoodSignature,
  scryfallPrintingUrl,
  signatureBlockedBy,
} from "@/lib/frames/frame-requests";

// ---------------------------------------------------------------------------
// The frame request row an import writes (TODO 1.6) and its art flag (TODO
// 1.18), over real printings run through the real mapper.
// ---------------------------------------------------------------------------

const SIGNATURE = signaturePrintings as unknown as Record<string, ScryfallCard>;
const IMPORTS = importPrintings as unknown as Record<string, ScryfallCard>;
const patchOf = (key: string) => mapScryfallToFormPatch(SIGNATURE[key] ?? IMPORTS[key]);

describe("frameRequestFromImport", () => {
  it("logs Sheoldred DMU #435 (borderless + crown) with its art window-cropped", () => {
    const row = frameRequestFromImport(patchOf("dmu-435"), {
      artImported: true,
      source: "import",
    });
    expect(row).toEqual({
      signature: "borderless/standard+crown",
      label: "Borderless frame",
      setCode: "dmu",
      collectorNumber: "435",
      scryfallId: SIGNATURE["dmu-435"].id,
      status: "nearest",
      template: "m15",
      artFlag: "window-cropped",
      source: "import",
    });
  });

  it("writes nothing for an exact printing (Llanowar Elves DOM #168 on the verified M15 frame)", () => {
    const patch = patchOf("dom-168");
    expect(patch.frame_match?.status).toBe("exact");
    expect(
      frameRequestFromImport(patch, {
        artImported: true,
        source: "import",
        verifiedKeys: new Set([frameComboKey("m15", "g")]),
      }),
    ).toBeNull();
  });

  it("logs an exact frame that isn't verified in the card's colour as nearest", () => {
    const patch = patchOf("dom-168");
    const row = frameRequestFromImport(patch, {
      artImported: false,
      source: "import",
      verifiedKeys: new Set([frameComboKey("m15", "r")]),
    });
    expect(row).toMatchObject({ signature: "era/2015", status: "nearest", artFlag: null });
  });

  it("logs unsupported printings, deck pre-fills and where the card really landed", () => {
    const row = frameRequestFromImport(patchOf("fut-18"), {
      artImported: false,
      source: "deck_prefill",
      landedTemplate: "m15artifact",
    });
    expect(row).toMatchObject({
      signature: "future",
      status: "unsupported",
      source: "deck_prefill",
      template: "m15artifact",
      setCode: "fut",
      collectorNumber: "18",
    });
  });

  it("skips a patch without a frame match (an older cached patch)", () => {
    const { frame_match: _drop, ...older } = patchOf("dmu-435");
    void _drop;
    expect(frameRequestFromImport(older, { artImported: true, source: "import" })).toBeNull();
  });

  it("every non-exact fixture printing makes a row the action accepts", () => {
    const keys = [...Object.keys(SIGNATURE), ...Object.keys(IMPORTS)];
    let logged = 0;
    for (const key of keys) {
      const row = frameRequestFromImport(patchOf(key), { artImported: true, source: "import" });
      if (!row) continue;
      logged += 1;
      const parsed = frameRequestSchema.safeParse(row);
      expect(parsed.success, `${key}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    }
    expect(logged).toBeGreaterThan(50);
  });
});

describe("artFlagForImport (TODO 1.18)", () => {
  it("is null without imported art", () => {
    expect(artFlagForImport(patchOf("dmu-435"), false)).toBeNull();
  });

  it("flags a borderless non-full-art printing as window-cropped", () => {
    expect(artFlagForImport(patchOf("dmu-435"), true)).toBe("window-cropped");
    expect(artFlagForImport(patchOf("eld-271"), true)).toBe("window-cropped");
  });

  it("flags full-art and textless printings as frame-in-crop, borderless or not", () => {
    expect(artFlagForImport(patchOf("fra-382"), true)).toBe("frame-in-crop"); // borderless full-art basic
    expect(artFlagForImport(patchOf("unf-235"), true)).toBe("frame-in-crop"); // borderless textless basic
    expect(artFlagForImport(patchOf("znr-266"), true)).toBe("frame-in-crop"); // black-bordered full-art basic
    expect(artFlagForImport(patchOf("sch-3"), true)).toBe("frame-in-crop"); // textless promo
  });

  it("leaves a black-bordered, windowed printing alone", () => {
    expect(artFlagForImport(patchOf("dmu-107"), true)).toBeNull();
    expect(artFlagForImport(patchOf("woe-328"), true)).toBeNull(); // extended art
  });

  it("reads the 1.16 treatment fields on an older patch without `printing`", () => {
    expect(
      artFlagForImport(
        { printing_treatment: "borderless", printing_detail: { set: "dmu", fullArt: false, textless: false } },
        true,
      ),
    ).toBe("window-cropped");
    expect(
      artFlagForImport(
        { printing_treatment: "fullart", printing_detail: { set: "znr", fullArt: true, textless: false } },
        true,
      ),
    ).toBe("frame-in-crop");
    expect(artFlagForImport({}, true)).toBeNull();
  });
});

describe("frameRequestSchema", () => {
  const valid = frameRequestFromImport(patchOf("dmu-435"), { artImported: true, source: "import" })!;

  it("accepts a real row", () => {
    expect(frameRequestSchema.safeParse(valid).success).toBe(true);
  });

  it("refuses an unknown signature, template, set code, status or source", () => {
    for (const bad of [
      { signature: "made/up" },
      { template: "notaframe" },
      { setCode: "DMU" },
      { setCode: "d" },
      { status: "exact" },
      { source: "api" },
      { artFlag: "blurry" },
      { scryfallId: "not-a-uuid" },
      { label: "" },
      { collectorNumber: "x".repeat(17) },
    ]) {
      expect(frameRequestSchema.safeParse({ ...valid, ...bad }).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("registry facts for the admin page", () => {
  it("knows the families PipGlyph will never build", () => {
    expect(isForGoodSignature("borderless/poster")).toBe(true);
    expect(isForGoodSignature("frameless/slz")).toBe(true);
    expect(isForGoodSignature("substitute-card")).toBe(true);
    expect(isForGoodSignature("borderless/standard+crown")).toBe(false);
    expect(isForGoodSignature("made/up")).toBe(false);
  });

  it("names the TODO item that would make a signature exact", () => {
    expect(signatureBlockedBy("borderless/standard+crown")).toBe("4.6");
    expect(signatureBlockedBy("era/2015")).toBeNull();
    expect(signatureBlockedBy("made/up")).toBeNull();
  });

  it("links a printing on Scryfall", () => {
    expect(scryfallPrintingUrl("dmu", "435")).toBe("https://scryfall.com/card/dmu/435");
    expect(scryfallPrintingUrl("plst", "ARB-1")).toBe("https://scryfall.com/card/plst/ARB-1");
    expect(scryfallPrintingUrl("sld", "1★")).toBe("https://scryfall.com/card/sld/1%E2%98%85");
    expect(scryfallPrintingUrl(null, "435")).toBeNull();
    expect(scryfallPrintingUrl("dmu", null)).toBeNull();
  });
});

describe("supabase/seeds/21_frame_requests.sql", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/seeds/21_frame_requests.sql"), "utf8");
  const rows = [
    ...sql.matchAll(
      /\('fa000000-[^']+', null, '([^']+)', '([^']+)', '([a-z0-9]+)', '([^']+)', '([0-9a-f-]{36})', '(nearest|unsupported)', '([a-z0-9]+)', (null|'[a-z-]+'), '(import|deck_prefill)'/g,
    ),
  ];

  it("seeds a handful of rows, every one in the shape this test reads", () => {
    expect(rows.length).toBeGreaterThanOrEqual(8);
    expect(rows.length).toBe(sql.match(/\('fa000000-/g)?.length);
  });

  it("uses real signatures, with the label and status the registry gives that printing", () => {
    const byId = new Map(
      [...Object.values(SIGNATURE), ...Object.values(IMPORTS)].map((card) => [card.id, card]),
    );
    for (const [, signature, label, set, collector, id, status] of rows) {
      expect(FRAME_SIGNATURE_KEYS).toContain(signature);
      const card = byId.get(id);
      expect(card, `${set} #${collector} is a fixture printing`).toBeTruthy();
      expect(card!.set).toBe(set);
      expect(card!.collector_number).toBe(collector);
      const match = mapScryfallToFormPatch(card!).frame_match!;
      expect({ signature: match.signature, label: match.exactLabel, status: match.status }).toEqual({
        signature,
        label,
        status,
      });
    }
  });
});
