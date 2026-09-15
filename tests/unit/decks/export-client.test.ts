import { describe, expect, it } from "vitest";
import JSZip from "jszip";
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

  it("builds a print PDF and always renders HD", async () => {
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
    expect(urls.filter((u) => u.includes("/api/cards/")).every((u) => u.endsWith("preset=hd"))).toBe(true);
    expect(urls.some((u) => u.includes("part=report"))).toBe(false);
    const head = new Uint8Array(await result.blob.slice(0, 5).arrayBuffer());
    expect(String.fromCharCode(...head)).toBe("%PDF-");
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
