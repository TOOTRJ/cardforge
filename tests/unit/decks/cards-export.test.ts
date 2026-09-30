import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import {
  carriesPrintBleed,
  DeckExportError,
  exportCardHref,
  isMpcExportRender,
  pngSize,
  runCardsExport,
  type CardsExportManifest,
} from "@/lib/decks/export-client";

// ---------------------------------------------------------------------------
// TODO 6.15 — runCardsExport: the deck export's browser pipeline for any
// selection. The manifest comes from POST /api/cards/export (ids + copies);
// each PDF card and HD image is its 600 ppi PRINT render — the art at full
// resolution (?ppi=600&corners=square&print=1, or &bleed=1 with the bleed);
// a standard ZIP image the 750 px square render; an MPC ZIP image
// MakePlayingCards' file (&bleed=mpc, TODO 6.1 — 1644 × 2244, portrait);
// the PDF takes the sheet options.
// ---------------------------------------------------------------------------

const manifest: CardsExportManifest = {
  cards: [
    { id: "c1", slug: "stone-matriarch", title: "Stone Matriarch", copies: 2 },
    { id: "c2", slug: "petrifying-glance", title: "Petrifying Glance", copies: 5 },
    { id: "c3", slug: "broken-one", title: "Broken One", copies: 1 },
  ],
  skipped: ["gone"],
  totalCopies: 8,
};

async function pngOf(width: number, height: number): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({ create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png().toBuffer(),
  );
}

type Call = { url: string; init?: RequestInit };

async function fakeFetch(calls: Call[], opts: { mpcCard?: Uint8Array } = {}) {
  const card = await pngOf(50, 70);
  const bleedCard = await pngOf(66, 90);
  const mpcCard = opts.mpcCard ?? (await pngOf(1644, 2244));
  return async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url === "/api/cards/export") return Response.json(manifest);
    if (url.includes("/api/cards/c3/png")) return Response.json({ error: "Render failed" }, { status: 500 });
    if (url.includes("/api/cards/")) {
      const bytes = url.includes("bleed=mpc") ? mpcCard : url.includes("bleed=1") ? bleedCard : card;
      return new Response(bytes as BodyInit, { headers: { "content-type": "image/png" } });
    }
    return new Response(null, { status: 404 });
  };
}

const request = {
  cards: [
    { id: "c1", copies: 2 },
    { id: "c2", copies: 5 },
    { id: "c3", copies: 1 },
    { id: "gone", copies: 1 },
  ],
  titles: { gone: "Old Draft" },
};

describe("runCardsExport", () => {
  it("POSTs the ids and copies, then builds the sheets from 600 ppi print renders with the sheet options", async () => {
    const calls: Call[] = [];
    const seen: string[] = [];
    const result = await runCardsExport(
      {
        ...request,
        kind: "pdf",
        quality: "default",
        layout: "sheet-a4",
        sheet: { gap: "sixteenth", marks: "lines", cardSize: "mm" },
      },
      { fetchImpl: await fakeFetch(calls), onProgress: (p) => seen.push(`${p.phase}:${p.done}/${p.total}`) },
    );

    expect(calls[0].url).toBe("/api/cards/export");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      cards: request.cards.map(({ id, copies }) => ({ id, copies })),
    });
    const cardUrls = calls.slice(1).map((c) => c.url);
    expect(cardUrls).toHaveLength(3);
    // A PDF is always the 600 ppi PRINT render (the art at full resolution,
    // TODO 6.10 — no longer the HD square render with its 1600 px art), and
    // print is square.
    expect(cardUrls.every((u) => u.endsWith("/png?ppi=600&corners=square&print=1"))).toBe(true);

    expect(result.filename).toBe("pipglyph-3-cards-sheets-a4.pdf");
    expect(result.title).toBe("3 cards");
    expect(result.cardsIncluded).toBe(2);
    // The skipped id is named by the title the dialog passed, then the render failure.
    expect(result.failed).toEqual(["Old Draft", "Broken One"]);
    const doc = await PDFDocument.load(new Uint8Array(await result.blob.arrayBuffer()));
    // 2 + 5 = 7 copies on one A4 sheet of 9.
    expect(doc.getPageCount()).toBe(1);
    expect(seen.at(-1)).toBe("packaging:3/3");
  });

  it("with the bleed, every card is its print render with the bleed — and the sheets make room for it", async () => {
    const calls: Call[] = [];
    const result = await runCardsExport(
      { ...request, kind: "pdf", quality: "hd", layout: "sheet-letter", bleed: true },
      { fetchImpl: await fakeFetch(calls), onProgress: () => {} },
    );
    const cardUrls = calls.slice(1).map((c) => new URL(c.url, "http://x"));
    expect(cardUrls.every((u) => u.searchParams.get("ppi") === "600")).toBe(true);
    expect(cardUrls.every((u) => u.searchParams.get("bleed") === "1")).toBe(true);
    expect(cardUrls.every((u) => u.searchParams.get("corners") === "square")).toBe(true);
    expect(result.filename).toBe("pipglyph-3-cards-sheets-bleed.pdf");
    const doc = await PDFDocument.load(new Uint8Array(await result.blob.arrayBuffer()));
    // 7 copies, 6 to a Letter bleed sheet.
    expect(doc.getPageCount()).toBe(2);
  });

  it("with the bleed, a render WITHOUT one is left out as failed — never stretched into a bleed cell", async () => {
    const calls: Call[] = [];
    const plain = await pngOf(50, 70);
    const base = await fakeFetch(calls);
    const result = await runCardsExport(
      { ...request, kind: "pdf", quality: "hd", layout: "sheet-letter", bleed: true },
      {
        // Stone Matriarch comes back as the 5:7 card, without its bleed.
        fetchImpl: async (url, init) =>
          url.includes("/api/cards/c1/png")
            ? new Response(plain as BodyInit, { headers: { "content-type": "image/png" } })
            : base(url, init),
        onProgress: () => {},
      },
    );
    // The skipped id first, then the renders in the order they finished.
    expect(result.failed[0]).toBe("Old Draft");
    expect([...result.failed].sort()).toEqual(["Broken One", "Old Draft", "Stone Matriarch"]);
    expect(result.cardsIncluded).toBe(1);
    const doc = await PDFDocument.load(new Uint8Array(await result.blob.arrayBuffer()));
    // Petrifying Glance's 5 copies only: one Letter bleed sheet of 6.
    expect(doc.getPageCount()).toBe(1);
  });

  it("carriesPrintBleed: 1650 × 2250 and its landscape turn, not the 5:7 card or a non-PNG", async () => {
    expect(pngSize(await pngOf(1650, 2250))).toEqual({ width: 1650, height: 2250 });
    expect(carriesPrintBleed(await pngOf(1650, 2250))).toBe(true);
    expect(carriesPrintBleed(await pngOf(2250, 1650))).toBe(true);
    expect(carriesPrintBleed(await pngOf(2200, 3000))).toBe(true); // 800 ppi + bleed
    expect(carriesPrintBleed(await pngOf(1500, 2100))).toBe(false);
    expect(carriesPrintBleed(await pngOf(2100, 1500))).toBe(false);
    expect(carriesPrintBleed(new TextEncoder().encode("<html>not a png</html>"))).toBe(false);
  });

  it("ZIP: one square image per card at the size asked, a MISSING note for what was left out", async () => {
    const calls: Call[] = [];
    const result = await runCardsExport(
      { ...request, kind: "zip", quality: "default", layout: "pages" },
      { fetchImpl: await fakeFetch(calls), onProgress: () => {} },
    );
    expect(calls.slice(1).every((c) => c.url.endsWith("/png?preset=default&corners=square"))).toBe(true);
    expect(result.filename).toBe("pipglyph-3-cards.zip");
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    expect(Object.keys(zip.files).sort()).toEqual([
      "MISSING.txt",
      "cards/",
      "cards/01-stone-matriarch.png",
      "cards/02-petrifying-glance.png",
    ]);
    expect(await zip.file("MISSING.txt")!.async("string")).toContain("Old Draft");
  });

  it("ZIP of HD images without the bleed: the 600 ppi print renders, named as before", async () => {
    const calls: Call[] = [];
    const result = await runCardsExport(
      { ...request, kind: "zip", quality: "hd", layout: "pages" },
      { fetchImpl: await fakeFetch(calls), onProgress: () => {} },
    );
    expect(calls.slice(1).every((c) => c.url.endsWith("/png?ppi=600&corners=square&print=1"))).toBe(true);
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    expect(Object.keys(zip.files)).toContain("cards/01-stone-matriarch.png");
    expect(result.filename).toBe("pipglyph-3-cards.zip");
  });

  it("ZIP with the bleed: the print renders, named -bleed", async () => {
    const calls: Call[] = [];
    const result = await runCardsExport(
      { ...request, kind: "zip", quality: "hd", layout: "pages", bleed: true },
      { fetchImpl: await fakeFetch(calls), onProgress: () => {} },
    );
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    expect(Object.keys(zip.files)).toContain("cards/01-stone-matriarch-bleed.png");
    expect(result.filename).toBe("pipglyph-3-cards-bleed.zip");
  });

  it("ZIP for MakePlayingCards (TODO 6.1): MPC's files — never the 1/8 in bleed on top — named -mpc", async () => {
    const calls: Call[] = [];
    const result = await runCardsExport(
      // A bleed left ticked in the settings is not added: MPC's file has its own.
      { ...request, kind: "zip", quality: "mpc", layout: "pages", bleed: true },
      { fetchImpl: await fakeFetch(calls), onProgress: () => {} },
    );
    expect(calls.slice(1).every((c) => c.url.endsWith("/png?ppi=600&corners=square&bleed=mpc"))).toBe(true);
    expect(result.filename).toBe("pipglyph-3-cards-mpc.zip");
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    expect(Object.keys(zip.files).sort()).toEqual([
      "MISSING.txt",
      "cards/",
      "cards/01-stone-matriarch-mpc.png",
      "cards/02-petrifying-glance-mpc.png",
    ]);
    expect(pngSize(await zip.file("cards/01-stone-matriarch-mpc.png")!.async("uint8array"))).toEqual({
      width: 1644,
      height: 2244,
    });
  });

  it("an MPC ZIP takes only MPC's exact file: a 1/8 in bleed render (0.1 % off its shape) or a landscape one is left out as failed", async () => {
    for (const wrong of [await pngOf(1650, 2250), await pngOf(2244, 1644), await pngOf(1500, 2100)]) {
      const calls: Call[] = [];
      const promise = runCardsExport(
        { ...request, kind: "zip", quality: "mpc", layout: "pages" },
        { fetchImpl: await fakeFetch(calls, { mpcCard: wrong }), onProgress: () => {} },
      );
      await expect(promise).rejects.toBeInstanceOf(DeckExportError);
    }
    expect(isMpcExportRender(await pngOf(1644, 2244))).toBe(true);
    expect(carriesPrintBleed(await pngOf(1644, 2244))).toBe(true); // why the shape alone can't tell
    expect(isMpcExportRender(await pngOf(1650, 2250))).toBe(false);
  });

  it("a PDF never asks for MPC's file, whatever the remembered image size", async () => {
    expect(exportCardHref("c1", { kind: "pdf", quality: "mpc", bleed: false })).toBe(
      "/api/cards/c1/png?ppi=600&corners=square&print=1",
    );
    expect(exportCardHref("c1", { kind: "pdf", quality: "mpc", bleed: true })).toBe(
      "/api/cards/c1/png?ppi=600&corners=square&bleed=1",
    );
    expect(exportCardHref("c1", { kind: "zip", quality: "mpc", bleed: false })).toBe(
      "/api/cards/c1/png?ppi=600&corners=square&bleed=mpc",
    );
  });

  it("surfaces the manifest's upgrade code (Pro, like the deck export)", async () => {
    await expect(
      runCardsExport(
        { ...request, kind: "pdf", quality: "hd", layout: "pages" },
        {
          fetchImpl: async () => Response.json({ error: "Pro only", code: "UPGRADE_REQUIRED" }, { status: 403 }),
          onProgress: () => {},
        },
      ),
    ).rejects.toMatchObject({ code: "UPGRADE_REQUIRED", message: "Pro only" });
  });

  it("fails clearly when no card renders", async () => {
    const promise = runCardsExport(
      { ...request, kind: "pdf", quality: "hd", layout: "pages" },
      {
        fetchImpl: async (url: string) =>
          url === "/api/cards/export" ? Response.json(manifest) : new Response(null, { status: 500 }),
        onProgress: () => {},
      },
    );
    await expect(promise).rejects.toBeInstanceOf(DeckExportError);
  });
});
