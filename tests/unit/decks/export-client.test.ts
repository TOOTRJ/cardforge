import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import {
  APPROX_BYTES_PER_CARD,
  DeckExportError,
  formatBytes,
  runDeckExport,
  type DeckExportManifest,
} from "@/lib/decks/export-client";

// A 1×1 PNG so pdf-lib can embed it.
const PNG_1PX = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);

const manifest: DeckExportManifest = {
  deck: { id: "d1", slug: "gorgon-gaze", title: "Gorgon Gaze" },
  cards: [
    { id: "c1", slug: "stone-matriarch", title: "Stone Matriarch", copies: 1 },
    { id: "c2", slug: "petrifying-glance", title: "Petrifying Glance", copies: 4 },
    { id: "c3", slug: "broken-one", title: "Broken One", copies: 1 },
  ],
  checklist: ["10× Forest", "1× Sol Ring  (Commander)"],
  hasCover: true,
  totalEntries: 17,
};

function fakeFetch(): (input: string, init?: RequestInit) => Promise<Response> {
  return async (input) => {
    if (input.includes("part=manifest")) return Response.json(manifest);
    if (input.includes("part=report")) return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), { headers: { "content-type": "application/pdf" } });
    if (input.includes("part=decklist")) return new Response("1 Stone Matriarch\n", { headers: { "content-type": "text/plain" } });
    if (input.includes("part=cover")) return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/webp" } });
    if (input.includes("/api/cards/c3/png")) return Response.json({ error: "Render failed" }, { status: 500 });
    if (input.includes("/api/cards/")) return new Response(PNG_1PX, { headers: { "content-type": "image/png" } });
    return new Response(null, { status: 404 });
  };
}

describe("runDeckExport", () => {
  it("builds a ZIP with clean cards, cover, report, decklist and a MISSING note, reporting progress", async () => {
    const seen: string[] = [];
    const result = await runDeckExport(
      { deckId: "d1", kind: "zip", quality: "default", layout: "pages" },
      { fetchImpl: fakeFetch(), onProgress: (p) => seen.push(`${p.phase}:${p.done}/${p.total}`) },
    );
    expect(result.filename).toBe("gorgon-gaze-deck.zip");
    expect(result.cardsIncluded).toBe(2);
    expect(result.failed).toEqual(["Broken One"]);
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    expect(Object.keys(zip.files).sort()).toEqual([
      "MISSING.txt",
      "cards/",
      "cards/01-stone-matriarch.png",
      "cards/02-petrifying-glance.png",
      "cover.webp",
      "deck.pdf",
      "decklist.txt",
    ]);
    expect(await zip.file("MISSING.txt")!.async("string")).toContain("Broken One");
    expect(await zip.file("MISSING.txt")!.async("string")).toContain("10× Forest");
    expect(seen[0]).toBe("preparing:0/0");
    expect(seen).toContain("rendering:3/3");
    expect(seen.at(-1)).toBe("packaging:3/3");
  });

  it("builds a print PDF from every card's 600 ppi PRINT render (full-resolution art)", async () => {
    const urls: string[] = [];
    const inner = fakeFetch();
    const result = await runDeckExport(
      { deckId: "d1", kind: "pdf", quality: "default", layout: "sheet-a4" },
      {
        fetchImpl: (input, init) => {
          urls.push(input);
          return inner(input, init);
        },
        onProgress: () => {},
      },
    );
    expect(result.filename).toBe("gorgon-gaze-sheets-a4.pdf");
    expect(result.blob.type).toBe("application/pdf");
    // The 600 ppi print render (TODO 6.10/6.15: the art composited at full
    // resolution, not the HD render's 1600 px inlined copy), SQUARE: the
    // sheets are cut along the rectangle (TODO 3.26).
    const cardUrls = urls.filter((u) => u.includes("/api/cards/"));
    expect(cardUrls.length).toBeGreaterThan(0);
    expect(cardUrls.every((u) => u.endsWith("/png?ppi=600&corners=square&print=1"))).toBe(true);
    expect(urls.some((u) => u.includes("part=report"))).toBe(false);
    const head = new Uint8Array(await result.blob.slice(0, 5).arrayBuffer());
    expect(String.fromCharCode(...head)).toBe("%PDF-");
  });

  it("asks for SQUARE cards in the ZIP too — print-service input, never transparent corners", async () => {
    // The png route's default is square as well, but a stale tab must not
    // depend on it: the export names the corner explicitly.
    const urls: string[] = [];
    const inner = fakeFetch();
    await runDeckExport(
      { deckId: "d1", kind: "zip", quality: "default", layout: "pages" },
      {
        fetchImpl: (input, init) => {
          urls.push(input);
          return inner(input, init);
        },
        onProgress: () => {},
      },
    );
    const cardUrls = urls.filter((u) => u.includes("/api/cards/"));
    expect(cardUrls).toHaveLength(3);
    expect(cardUrls.every((u) => new URL(u, "http://x").searchParams.get("corners") === "square")).toBe(true);
    expect(cardUrls.every((u) => new URL(u, "http://x").searchParams.get("preset") === "default")).toBe(true);
  });

  it("the HD ZIP's images are the 600 ppi print renders too; the standard ZIP keeps the 750 px render", async () => {
    for (const [quality, expected] of [
      ["hd", "/png?ppi=600&corners=square&print=1"],
      ["default", "/png?preset=default&corners=square"],
    ] as const) {
      const urls: string[] = [];
      const inner = fakeFetch();
      await runDeckExport(
        // A bleed asked for a ZIP is ignored: the bleed is a PDF option here.
        { deckId: "d1", kind: "zip", quality, layout: "pages", bleed: true },
        {
          fetchImpl: (input, init) => {
            urls.push(input);
            return inner(input, init);
          },
          onProgress: () => {},
        },
      );
      const cardUrls = urls.filter((u) => u.includes("/api/cards/"));
      expect(cardUrls).toHaveLength(3);
      expect(cardUrls.every((u) => u.endsWith(expected))).toBe(true);
    }
  });

  it("an MPC ZIP (TODO 6.1): MakePlayingCards' files, named -mpc, in a -mpc ZIP", async () => {
    const mpcPng = new Uint8Array(
      await sharp({ create: { width: 1644, height: 2244, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png().toBuffer(),
    );
    const urls: string[] = [];
    const inner = fakeFetch();
    const result = await runDeckExport(
      { deckId: "d1", kind: "zip", quality: "mpc", layout: "pages", bleed: true },
      {
        fetchImpl: async (input, init) => {
          urls.push(input);
          if (input.includes("/api/cards/c1/png") || input.includes("/api/cards/c2/png")) {
            return new Response(mpcPng as BodyInit, { headers: { "content-type": "image/png" } });
          }
          // c3 answers the 1 px render (not MPC's file): left out as failed.
          return inner(input, init);
        },
        onProgress: () => {},
      },
    );
    const cardUrls = urls.filter((u) => u.includes("/api/cards/"));
    expect(cardUrls).toHaveLength(3);
    expect(cardUrls.every((u) => u.endsWith("/png?ppi=600&corners=square&bleed=mpc"))).toBe(true);
    expect(result.filename).toBe("gorgon-gaze-deck-mpc.zip");
    expect(result.failed).toEqual(["Broken One"]);
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    expect(Object.keys(zip.files).filter((name) => name.startsWith("cards/")).sort()).toEqual([
      "cards/",
      "cards/01-stone-matriarch-mpc.png",
      "cards/02-petrifying-glance-mpc.png",
    ]);
    expect(APPROX_BYTES_PER_CARD.mpc).toBeGreaterThan(APPROX_BYTES_PER_CARD.hd);
  });

  describe("both faces (TODO 5.3)", () => {
    // Stone Matriarch is a transform card: the manifest lists its back.
    const dfcManifest: DeckExportManifest = {
      ...manifest,
      cards: [
        { ...manifest.cards[0], faces: ["front", "back"] },
        { ...manifest.cards[1], faces: ["front"] },
        manifest.cards[2],
      ],
    };
    function dfcFetch(urls: string[], opts: { backFails?: boolean; png?: Uint8Array } = {}) {
      const inner = fakeFetch();
      return async (input: string, init?: RequestInit) => {
        urls.push(input);
        if (input.includes("part=manifest")) return Response.json(dfcManifest);
        if (opts.backFails && input.includes("face=back")) return Response.json({ error: "Render failed" }, { status: 500 });
        if (opts.png && input.includes("/api/cards/c1/png")) return new Response(opts.png as BodyInit, { headers: { "content-type": "image/png" } });
        return inner(input, init);
      };
    }

    it("the ZIP fetches the back as the same render with &face=back and adds <slug>-back.png beside the front", async () => {
      const urls: string[] = [];
      const seen: string[] = [];
      const result = await runDeckExport(
        { deckId: "d1", kind: "zip", quality: "hd", layout: "pages" },
        { fetchImpl: dfcFetch(urls), onProgress: (p) => seen.push(`${p.phase}:${p.done}/${p.total}`) },
      );
      const cardUrls = urls.filter((u) => u.includes("/api/cards/"));
      expect(cardUrls).toEqual([
        "/api/cards/c1/png?ppi=600&corners=square&print=1",
        "/api/cards/c1/png?ppi=600&corners=square&print=1&face=back",
        "/api/cards/c2/png?ppi=600&corners=square&print=1",
        "/api/cards/c3/png?ppi=600&corners=square&print=1",
      ]);
      // Progress counts renders, so the back is one more.
      expect(seen).toContain("rendering:4/4");
      const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
      expect(Object.keys(zip.files).filter((name) => name.startsWith("cards/")).sort()).toEqual([
        "cards/",
        "cards/01-stone-matriarch-back.png",
        "cards/01-stone-matriarch.png",
        "cards/02-petrifying-glance.png",
      ]);
      expect(result.cardsIncluded).toBe(2);
    });

    it("an MPC ZIP names the back <slug>-back-mpc.png", async () => {
      const mpcPng = new Uint8Array(
        await sharp({ create: { width: 1644, height: 2244, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png().toBuffer(),
      );
      const urls: string[] = [];
      const result = await runDeckExport(
        { deckId: "d1", kind: "zip", quality: "mpc", layout: "pages" },
        { fetchImpl: dfcFetch(urls, { png: mpcPng }), onProgress: () => {} },
      );
      expect(urls.filter((u) => u.includes("/api/cards/c1/"))).toEqual([
        "/api/cards/c1/png?ppi=600&corners=square&bleed=mpc",
        "/api/cards/c1/png?ppi=600&corners=square&bleed=mpc&face=back",
      ]);
      const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
      expect(Object.keys(zip.files).filter((name) => name.includes("stone-matriarch")).sort()).toEqual([
        "cards/01-stone-matriarch-back-mpc.png",
        "cards/01-stone-matriarch-mpc.png",
      ]);
    });

    it("the PDF carries the back: a page of its own on pages, beside its front on a sheet", async () => {
      const pages = await runDeckExport(
        { deckId: "d1", kind: "pdf", quality: "hd", layout: "pages" },
        { fetchImpl: dfcFetch([]), onProgress: () => {} },
      );
      // Stone Matriarch (front + back), Petrifying Glance, then the checklist page.
      expect((await PDFDocument.load(await pages.blob.arrayBuffer())).getPageCount()).toBe(4);
      const sheets = await runDeckExport(
        { deckId: "d1", kind: "pdf", quality: "hd", layout: "sheet-letter" },
        { fetchImpl: dfcFetch([]), onProgress: () => {} },
      );
      // 1 pair + 4 singles = 6 cells on one sheet, then the checklist page.
      expect((await PDFDocument.load(await sheets.blob.arrayBuffer())).getPageCount()).toBe(2);
    });

    it("includeBacks: false fetches the front only — the export as it was before 5.3", async () => {
      const urls: string[] = [];
      const result = await runDeckExport(
        { deckId: "d1", kind: "zip", quality: "hd", layout: "pages", includeBacks: false },
        { fetchImpl: dfcFetch(urls), onProgress: () => {} },
      );
      expect(urls.filter((u) => u.includes("face=back"))).toEqual([]);
      const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
      expect(Object.keys(zip.files).filter((name) => name.includes("stone-matriarch"))).toEqual(["cards/01-stone-matriarch.png"]);
    });

    it("a back that fails to render is listed by name; the card's front still prints", async () => {
      const result = await runDeckExport(
        { deckId: "d1", kind: "zip", quality: "hd", layout: "pages" },
        { fetchImpl: dfcFetch([], { backFails: true }), onProgress: () => {} },
      );
      expect(result.failed).toEqual(["Stone Matriarch (back)", "Broken One"]);
      const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
      expect(Object.keys(zip.files).filter((name) => name.includes("stone-matriarch"))).toEqual(["cards/01-stone-matriarch.png"]);
    });

    it("a manifest from before 5.3 (no faces) is the front only", async () => {
      const urls: string[] = [];
      await runDeckExport(
        { deckId: "d1", kind: "zip", quality: "hd", layout: "pages" },
        {
          fetchImpl: (input, init) => {
            urls.push(input);
            return fakeFetch()(input, init);
          },
          onProgress: () => {},
        },
      );
      expect(urls.filter((u) => u.includes("face=back"))).toEqual([]);
    });
  });

  it("takes the print options: sheet gap / guides / size and the bleed (TODO 6.15)", async () => {
    const bleedPng = new Uint8Array(
      await sharp({ create: { width: 66, height: 90, channels: 3, background: "#000000" } }).png().toBuffer(),
    );
    const urls: string[] = [];
    const result = await runDeckExport(
      {
        deckId: "d1",
        kind: "pdf",
        quality: "hd",
        layout: "sheet-letter",
        sheet: { gap: "sixteenth", marks: "lines", cardSize: "mm" },
        bleed: true,
      },
      {
        fetchImpl: async (input) => {
          urls.push(input);
          if (input.includes("part=manifest")) return Response.json(manifest);
          // Stone Matriarch comes back WITHOUT its bleed: left out, never
          // stretched into a bleed cell.
          if (input.includes("/api/cards/c1/png")) return new Response(PNG_1PX, { headers: { "content-type": "image/png" } });
          if (input.includes("/api/cards/c3/png")) return Response.json({ error: "Render failed" }, { status: 500 });
          if (input.includes("/api/cards/")) return new Response(bleedPng, { headers: { "content-type": "image/png" } });
          return new Response(null, { status: 404 });
        },
        onProgress: () => {},
      },
    );
    const cardUrls = urls.filter((u) => u.includes("/api/cards/"));
    expect(cardUrls.every((u) => u.endsWith("/png?ppi=600&corners=square&bleed=1"))).toBe(true);
    expect(result.filename).toBe("gorgon-gaze-sheets-bleed.pdf");
    expect(result.failed.sort()).toEqual(["Broken One", "Stone Matriarch"]);
    const doc = await PDFDocument.load(new Uint8Array(await result.blob.arrayBuffer()));
    // Petrifying Glance × 4 on a Letter bleed sheet — landscape — then the
    // checklist page (on Letter).
    expect(doc.getPage(0).getSize()).toEqual({ width: 792, height: 612 });
    expect(doc.getPageCount()).toBe(2);
  });

  it("surfaces the upgrade code from the manifest request", async () => {
    await expect(
      runDeckExport(
        { deckId: "d1", kind: "zip", quality: "hd", layout: "pages" },
        {
          fetchImpl: async () => Response.json({ error: "Pro only", code: "UPGRADE_REQUIRED" }, { status: 403 }),
          onProgress: () => {},
        },
      ),
    ).rejects.toMatchObject({ code: "UPGRADE_REQUIRED", message: "Pro only" });
  });

  it("stops on cancel", async () => {
    const controller = new AbortController();
    const inner = fakeFetch();
    const promise = runDeckExport(
      { deckId: "d1", kind: "zip", quality: "hd", layout: "pages" },
      {
        fetchImpl: async (input, init) => {
          if (input.includes("/api/cards/")) controller.abort();
          return inner(input, init);
        },
        onProgress: () => {},
        signal: controller.signal,
      },
    );
    await expect(promise).rejects.toBeInstanceOf(DeckExportError);
    await expect(promise).rejects.toMatchObject({ code: "CANCELLED" });
  });
});

describe("formatBytes", () => {
  it("scales sensibly", () => {
    expect(formatBytes(60 * 1024)).toBe("60 KB");
    expect(formatBytes(APPROX_BYTES_PER_CARD.hd)).toBe("3.2 MB");
    expect(formatBytes(100 * APPROX_BYTES_PER_CARD.hd)).toBe("320 MB");
    expect(formatBytes(400 * APPROX_BYTES_PER_CARD.hd)).toBe("1.3 GB");
  });
});
