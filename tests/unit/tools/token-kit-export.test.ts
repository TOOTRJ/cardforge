import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { exportCardHref, kitRenderHref, runKitExport, type KitExportRequest } from "@/lib/decks/export-client";

// ---------------------------------------------------------------------------
// The Token Kit's print / download (runKitExport): tokens that are no card
// rows, each POSTed to /api/tools/token-kit/render with its body, under the
// SAME render choice as a card (exportCardHref's query on the kit route),
// the same bleed / MPC checks and the same PDF builder and ZIP.
// ---------------------------------------------------------------------------

async function pngOf(width: number, height: number): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({ create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png().toBuffer(),
  );
}

type Call = { url: string; init?: RequestInit };

async function fakeFetch(calls: Call[]) {
  const card = await pngOf(50, 70);
  const bleedCard = await pngOf(66, 90);
  return async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    if (body?.face?.title === "Broken") return Response.json({ error: "Render failed" }, { status: 500 });
    if (url.startsWith("/api/tools/token-kit/render")) {
      return new Response((url.includes("bleed=1") ? bleedCard : card) as BodyInit, { headers: { "content-type": "image/png" } });
    }
    return new Response(null, { status: 404 });
  };
}

const tokenBody = (title: string) => ({ face: { title }, settings: {}, state: {} });

function kitRequest(overrides: Partial<KitExportRequest> = {}): KitExportRequest {
  return {
    kit: {
      title: "Atraxa tokens",
      slug: "atraxa-tokens",
      tokens: [
        { key: "a", title: "Treasure", slug: "treasure", copies: 3, body: tokenBody("Treasure") },
        { key: "b", title: "Spirit", slug: "spirit", copies: 2, body: tokenBody("Spirit") },
        { key: "c", title: "Broken", slug: "broken", copies: 1, body: tokenBody("Broken") },
        { key: "d", title: "Left out", slug: "left-out", copies: 0, body: tokenBody("Left out") },
      ],
    },
    kind: "pdf",
    quality: "hd",
    layout: "sheet-letter",
    ...overrides,
  };
}

describe("kitRenderHref", () => {
  it("is the card render's query on the kit route", () => {
    for (const opts of [
      { kind: "pdf" as const, quality: "hd" as const, bleed: false },
      { kind: "pdf" as const, quality: "hd" as const, bleed: true },
      { kind: "zip" as const, quality: "default" as const, bleed: false },
      { kind: "zip" as const, quality: "mpc" as const, bleed: false },
    ]) {
      const card = exportCardHref("x", opts);
      expect(kitRenderHref(opts)).toBe(`/api/tools/token-kit/render${card.slice(card.indexOf("?"))}`);
    }
    expect(kitRenderHref({ kind: "pdf", quality: "hd", bleed: false })).toContain("print=1");
    expect(kitRenderHref({ kind: "zip", quality: "default", bleed: false })).toContain("preset=default");
  });
});

describe("runKitExport", () => {
  it("POSTs each token's body, skips a 0-copy token, names a failed one, prints copies", async () => {
    const calls: Call[] = [];
    const result = await runKitExport(kitRequest(), { fetchImpl: await fakeFetch(calls), onProgress: () => {} });
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.init?.method).toBe("POST");
      expect(call.url).toContain("print=1");
    }
    expect(calls.map((call) => JSON.parse(String(call.init?.body)).face.title)).toEqual(["Treasure", "Spirit", "Broken"]);
    expect(result.failed).toEqual(["Broken"]);
    expect(result.cardsIncluded).toBe(2);
    expect(result.filename).toBe("atraxa-tokens-sheets.pdf");
    const pdf = await PDFDocument.load(new Uint8Array(await result.blob.arrayBuffer()));
    // 3 + 2 copies on one Letter sheet.
    expect(pdf.getPageCount()).toBe(1);
  });

  it("a ZIP holds one image per token, the bleed's suffix, a MISSING note", async () => {
    const calls: Call[] = [];
    const result = await runKitExport(kitRequest({ kind: "zip", quality: "hd", bleed: true }), {
      fetchImpl: await fakeFetch(calls),
      onProgress: () => {},
    });
    expect(calls.every((call) => call.url.includes("bleed=1"))).toBe(true);
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    expect(Object.keys(zip.files).filter((name) => !zip.files[name].dir).sort()).toEqual(["MISSING.txt", "cards/01-treasure-bleed.png", "cards/02-spirit-bleed.png"]);
    expect(result.filename).toBe("atraxa-tokens-bleed.zip");
  });

  it("refuses an empty kit and a kit nothing rendered for", async () => {
    await expect(
      runKitExport(kitRequest({ kit: { title: "x", slug: "x", tokens: [] } }), { fetchImpl: await fakeFetch([]), onProgress: () => {} }),
    ).rejects.toThrow(/at least one token/);
    await expect(
      runKitExport(kitRequest(), { fetchImpl: async () => Response.json({ code: "UPGRADE_REQUIRED" }, { status: 403 }), onProgress: () => {} }),
    ).rejects.toThrow(/None of the tokens/);
  });
});
