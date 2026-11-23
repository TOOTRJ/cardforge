import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FrameAssetUnavailableError,
  LOCAL_TREE_SENTINELS,
  assetOrigins,
  frameAssetPath,
  getFrameDataUrl,
  getPlateDataUrlForPath,
  loadFrameMasterBytes,
  plateAssetPath,
  preloadFrame,
  preloadFrameAssets,
  resetFrameAssetCacheForTests,
} from "@/lib/render/card-frames";
import { frameManifestEntry, setFrameStorageForTests, type FrameManifest } from "@/lib/frames/frame-url";
import { frameAssetPathsFor } from "@/lib/render/card-image";
import type { CardPreviewData } from "@/components/cards/card-preview";

const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  "base64",
);
const dataUrl = (bytes: Buffer) => `data:image/png;base64,${bytes.toString("base64")}`;
const pngAnswer = (bytes: Buffer) => new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": "image/png" } });

/** A deployment as Vercel runs it: `public/frames` is not in the function
 *  (next.config.ts excludes it), so git assets come from the site's CDN —
 *  one origin, https://cdn.example. */
function deployed(): void {
  vi.spyOn(process, "cwd").mockReturnValue(path.join(os.tmpdir(), "pipglyph-deployment-without-public-frames"));
  vi.stubEnv("RENDER_ASSET_ORIGIN", "https://cdn.example");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://cdn.example");
  vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
}

describe("card-frames — frame assets resolve from disk or the deployment CDN", () => {
  beforeEach(() => resetFrameAssetCacheForTests());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("builds public paths the way the renderer references them", () => {
    expect(frameAssetPath("m15", "w")).toBe("/frames/m15/w.png");
    expect(frameAssetPath("m15", "nonsense")).toBe("/frames/m15/c.png");
    expect(plateAssetPath("/frames/m15/pt/{color}.png", "u")).toBe("/frames/m15/pt/u.png");
    expect(plateAssetPath("/frames/m15pw/loyaltyup.png", "g")).toBe("/frames/m15pw/loyaltyup.png");
  });

  it("orders fetch origins explicit → site URL → production, de-duplicated", () => {
    vi.stubEnv("RENDER_ASSET_ORIGIN", "assets.example.com/");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://www.pipglyph.com");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "www.pipglyph.com");
    expect(assetOrigins()).toEqual(["https://assets.example.com", "https://www.pipglyph.com"]);
  });

  it("reads real masters from disk without any fetch (local dev / tests)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    // (The M15 family left git for the frames bucket in v24 — these are
    // masters that are still committed.)
    await preloadFrame("tarkirdraconic", "w"); // a git master (tarkirdragon left git with TODO 4.11)
    await preloadFrameAssets(["/frames/tarkirdraconic/pt/w.png"]);
    expect(getFrameDataUrl("tarkirdraconic", "w").startsWith("data:image/png;base64,")).toBe(true);
    expect(getPlateDataUrlForPath("/frames/tarkirdraconic/pt/{color}.png", "w")).toMatch(/^data:image\/png;base64,/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("decides 'this tree holds the git files' by a sentinel that is in git and outside the frames manifest", () => {
    for (const [folder, sentinel] of Object.entries(LOCAL_TREE_SENTINELS)) {
      expect(sentinel.startsWith(`${folder}/`), sentinel).toBe(true);
      expect(fs.existsSync(path.join(process.cwd(), "public", sentinel)), sentinel).toBe(true);
      expect(frameManifestEntry(sentinel), sentinel).toBeNull();
    }
  });

  it("next.config.ts keeps public/frames out of every function (the loader fetches git frames from the CDN there)", () => {
    const config = fs.readFileSync(path.join(process.cwd(), "next.config.ts"), "utf8");
    expect(config).toMatch(/outputFileTracingExcludes:\s*\{\s*"\*":\s*\[[^\]]*"\.\/public\/frames\/\*\*"/);
  });

  it("fetches from the CDN where the frames folder isn't deployed, and memoizes it", async () => {
    deployed();
    const png = PIXEL;
    const fetchSpy = vi.fn(async (input: string) =>
      input.endsWith("/frames/not-a-real-template/w.png") ? pngAnswer(png) : new Response(null, { status: 404 }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    await preloadFrame("not-a-real-template", "w");
    expect(getFrameDataUrl("not-a-real-template", "w")).toBe(dataUrl(png));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe("https://cdn.example/frames/not-a-real-template/w.png");
    await preloadFrame("not-a-real-template", "w");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("treats a protected preview's HTML answer as no answer and tries the next origin", async () => {
    deployed();
    vi.stubEnv("RENDER_ASSET_ORIGIN", "https://preview.example");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://www.pipglyph.com");
    const png = PIXEL;
    const fetchSpy = vi.fn(async (input: string) =>
      input.startsWith("https://preview.example")
        ? new Response("<html>Vercel Authentication</html>", { status: 200, headers: { "content-type": "text/html" } })
        : pngAnswer(png),
    );
    vi.stubGlobal("fetch", fetchSpy);
    await preloadFrameAssets(["/frames/not-a-real-template/pt/w.png"]);
    expect(getPlateDataUrlForPath("/frames/not-a-real-template/pt/{color}.png", "w")).toBe(dataUrl(png));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("lists the plates and loyalty badges a card's frame will ask for", () => {
    const base = {
      title: "T",
      cost: "{1}{W}",
      cardType: "creature",
      supertype: null,
      subtypes: ["Human"],
      rarity: "common",
      colorIdentity: ["white"],
      rulesText: "",
      flavorText: "",
      power: "1",
      toughness: "1",
      loyalty: null,
      defense: null,
      artistCredit: null,
      artUrl: null,
      frameStyle: { template: "m15" },
    } as unknown as CardPreviewData;
    expect(frameAssetPathsFor(base)).toEqual(["/frames/m15/pt/w.png"]);

    const walker = {
      ...base,
      cardType: "planeswalker",
      subtypes: ["Jace"],
      colorIdentity: ["blue"],
      loyalty: "3",
      rulesText: "+1: Draw a card.\n−2: Return target creature.\n0: Scry 1.",
      frameStyle: { template: "m15pw" },
    } as unknown as CardPreviewData;
    const paths = frameAssetPathsFor(walker);
    expect(paths).toContain("/frames/m15pw/loyaltyup.png");
    expect(paths).toContain("/frames/m15pw/loyaltydown.png");
    expect(paths).toContain("/frames/m15pw/loyaltynaught.png");
    // Card Conjurer's planeswalker masters paint the starting-loyalty
    // shield themselves (frames swap 4.4) — no separate plate is fetched.
    expect(paths).not.toContain("/frames/m15pw/loyalty.png");
  });

  it("lists a basic land's symbol image from the profile's slot (TODO 3.23 / 3.24)", () => {
    const plains = {
      title: "Plains",
      cardType: "land",
      supertype: "Basic",
      subtypes: ["Plains"],
      colorIdentity: ["white"],
      frameStyle: { template: "fullartland" },
    } as unknown as CardPreviewData;
    const slot = {
      rect: { topPct: 83.43, leftPct: 4.13, widthPct: 11.2, heightPct: 8 },
      style: "glyph" as const,
      assetPathTemplate: "/frames/fullartland/symbol/{symbol}.png",
    };
    // Without a slot, nothing: the profile's P/T plate is never preloaded
    // for a land, which prints none (TODO 4.5.0 — the pre-4.39 fullartland;
    // m15textlessland today).
    expect(frameAssetPathsFor({ ...plains, frameStyle: { template: "m15textlessland" } })).toEqual([]);
    // The full-art basics (4.39) preload their own symbol image.
    expect(frameAssetPathsFor(plains)).toEqual(["/frames/fullartland/symbol/w.png"]);
    expect(frameAssetPathsFor({ ...plains, frameStyle: { template: "m15fullartland" } })).toEqual([
      "/frames/m15fullartland/symbol/w.png",
    ]);
    // …and the borderless M15 frame (4.32) its own P/T plate.
    expect(
      frameAssetPathsFor({
        title: "Bear",
        cardType: "creature",
        colorIdentity: ["green"],
        power: "2",
        toughness: "2",
        frameStyle: { template: "m15borderless" },
      } as unknown as CardPreviewData),
    ).toEqual(["/frames/m15borderless/pt/g.png"]);
    expect(frameAssetPathsFor({ ...plains, profileOverrides: { fullartland: { basicSymbol: slot } } })).toEqual([
      "/frames/fullartland/symbol/w.png",
    ]);
    // An explicit mana watermark swaps the symbol it preloads.
    expect(
      frameAssetPathsFor({
        ...plains,
        watermark: { kind: "mana", key: "g", size: "large" },
        profileOverrides: { fullartland: { basicSymbol: slot } },
      }),
    ).toEqual(["/frames/fullartland/symbol/g.png"]);
    // A textless planeswalker draws no ability rows: no badges.
    const walker = {
      title: "W",
      cardType: "planeswalker",
      colorIdentity: ["blue"],
      loyalty: "3",
      rulesText: "+1: Draw a card.",
      frameStyle: { template: "m15pw" },
    } as unknown as CardPreviewData;
    expect(frameAssetPathsFor(walker)).toContain("/frames/m15pw/loyaltyup.png");
    expect(frameAssetPathsFor({ ...walker, profileOverrides: { m15pw: { textless: true } } })).not.toContain(
      "/frames/m15pw/loyaltyup.png",
    );
  });
});

// ---------------------------------------------------------------------------
// A git asset (the 1993 pair, Avatar, the Bloomburrow and Tarkir frames, git
// plates and overlays, the walker's loyalty badges) the deployment's CDN
// fails on: storage that is BUSY is not storage that lacks the file. Before,
// one 503 was cached like a 404 for the instance's life and the 1993 frame
// drew M15's master — its bake stored as current. A failure that may pass is
// now never cached and fails the render (FrameAssetUnavailableError: the save
// bake and the sweep keep the card for a retry); only a 404 — or a file
// absent from a local frames folder that IS on disk — is a miss.
// ---------------------------------------------------------------------------

describe("card-frames — a git asset the CDN fails on is never a miss", () => {
  const BUCKET = "https://bucket.example/frames";
  const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  const M15_G = Buffer.concat([PIXEL, Buffer.from("m15/g")]);
  const ALPHA_G = Buffer.concat([PIXEL, Buffer.from("agclassic/g")]);
  const m15Url = `${BUCKET}/m15/g.${sha(M15_G).slice(0, 12)}.png`;
  let restoreStorage: () => void = () => {};

  beforeEach(() => {
    resetFrameAssetCacheForTests();
    // The default template's master — the fallback — is a bucket object.
    const manifest: FrameManifest = {
      version: 1,
      bucket: "frames",
      files: { "m15/g.png": { hash: sha(M15_G).slice(0, 12), sha256: sha(M15_G), bytes: M15_G.length, width: 1, height: 1 } },
    };
    restoreStorage = setFrameStorageForTests({ manifest, origin: BUCKET });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    restoreStorage();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  /** The CDN answers `cdn(url)`; the bucket serves M15's master. */
  function serve(cdn: (url: string) => Response | Promise<Response>) {
    const spy = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === m15Url) return pngAnswer(M15_G);
      return cdn(url);
    });
    vi.stubGlobal("fetch", spy);
    return spy;
  }
  const cdnCalls = (spy: ReturnType<typeof serve>) =>
    spy.mock.calls.filter(([url]) => String(url).startsWith("https://cdn.example")).length;

  /** The loader's clock (its 30 s retry window), moved by hand. */
  function clock() {
    let now = Date.parse("2026-11-23T12:00:00Z");
    vi.spyOn(Date, "now").mockImplementation(() => now);
    return { advance: (ms: number) => (now += ms) };
  }

  it("one 503 fails that preload and nothing else: the very next render fetches again and draws the real master — never M15's", async () => {
    deployed();
    clock();
    let up = false;
    const spy = serve((url) =>
      url === "https://cdn.example/frames/agclassic/g.png" && up ? pngAnswer(ALPHA_G) : new Response("busy", { status: 503 }),
    );
    await expect(preloadFrame("agclassic", "g")).rejects.toThrow(/frames\/agclassic\/g\.png/);
    // The renderer's getter never substitutes the default template's frame
    // for a master it never loaded.
    expect(() => getFrameDataUrl("agclassic", "g")).toThrow(FrameAssetUnavailableError);
    expect(spy.mock.calls.some(([url]) => String(url) === m15Url)).toBe(false);
    // The CDN recovers: no window after one 5xx — the next render retries.
    up = true;
    await preloadFrame("agclassic", "g");
    expect(getFrameDataUrl("agclassic", "g")).toBe(dataUrl(ALPHA_G));
    expect(cdnCalls(spy)).toBe(2);
  });

  it("one 503 then recovery, across eight walkers baked in a row: only the first fails", async () => {
    // The re-bake batch's shape: eight walker cards, each preloading the git
    // loyalty badge. A window opened by the one blip failed all eight (and
    // the batch breaker paused the sweep); now only the card that met the
    // blip fails, and the batch stops there without striking it
    // (lib/cards/rebake-batch.ts).
    deployed();
    clock();
    let calls = 0;
    const spy = serve((url) => {
      if (!url.endsWith("/frames/m15pw/loyaltyup.png")) return new Response(null, { status: 404 });
      calls += 1;
      return calls === 1 ? new Response(null, { status: 503 }) : pngAnswer(PIXEL);
    });
    const outcomes: string[] = [];
    for (let walker = 0; walker < 8; walker += 1) {
      outcomes.push(
        await preloadFrameAssets(["/frames/m15pw/loyaltyup.png"]).then(
          () => "ok",
          (err: unknown) => (err instanceof FrameAssetUnavailableError ? "unavailable" : "error"),
        ),
      );
    }
    expect(outcomes).toEqual(["unavailable", "ok", "ok", "ok", "ok", "ok", "ok", "ok"]);
    expect(cdnCalls(spy)).toBe(2);
  });

  it("a TIMEOUT opens the retry window at once: the renders inside it fail without waiting again", async () => {
    vi.useFakeTimers();
    try {
      deployed();
      const hang = vi.fn(
        (_input: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new Error("This operation was aborted")));
          }),
      );
      vi.stubGlobal("fetch", hang);
      const paths = ["/frames/m15pw/loyaltyup.png"];
      const first = expect(preloadFrameAssets(paths)).rejects.toBeInstanceOf(FrameAssetUnavailableError);
      await vi.advanceTimersByTimeAsync(10_000);
      await first;
      expect(hang).toHaveBeenCalledTimes(1);
      // Inside the window: fails at once, no fetch, no wait.
      await expect(preloadFrameAssets(paths)).rejects.toBeInstanceOf(FrameAssetUnavailableError);
      expect(hang).toHaveBeenCalledTimes(1);
      // After it: the CDN is asked again.
      await vi.advanceTimersByTimeAsync(30_001);
      const third = expect(preloadFrameAssets(paths)).rejects.toBeInstanceOf(FrameAssetUnavailableError);
      await vi.advanceTimersByTimeAsync(10_000);
      await third;
      expect(hang).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["a 500", () => new Response(null, { status: 500 })],
    ["a 502", () => new Response(null, { status: 502 })],
    ["a 429", () => new Response(null, { status: 429 })],
    ["a refused connection", () => Promise.reject(new TypeError("fetch failed"))],
    ["an aborted fetch", () => Promise.reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" }))],
    ["an HTML page from the only origin", () => new Response("<html>Sign in</html>", { status: 200, headers: { "content-type": "text/html" } })],
    ["a 401 from the only origin", () => new Response(null, { status: 401 })],
    ["an empty image", () => new Response(new Uint8Array(0), { status: 200, headers: { "content-type": "image/png" } })],
  ])("%s for a plate or a loyalty badge fails the preload; a second failure in a row opens the retry window; after it the CDN is asked again", async (_label, answer) => {
    deployed();
    const time = clock();
    const spy = serve(answer);
    const paths = ["/frames/m15pw/loyaltyup.png", "/frames/agclassic/pt/g.png"];
    await expect(preloadFrameAssets(paths)).rejects.toThrow(FrameAssetUnavailableError);
    expect(cdnCalls(spy)).toBe(2);
    // One failure opens no window: the next render asks again.
    await expect(preloadFrameAssets(paths)).rejects.toThrow(/frames\/m15pw\/loyaltyup\.png, frames\/agclassic\/pt\/g\.png/);
    expect(cdnCalls(spy)).toBe(4);
    // Two in a row did: the renders inside it fail at once.
    await expect(preloadFrameAssets(paths)).rejects.toThrow(FrameAssetUnavailableError);
    expect(cdnCalls(spy)).toBe(4);
    time.advance(30_001);
    await expect(preloadFrameAssets(paths)).rejects.toThrow(FrameAssetUnavailableError);
    expect(cdnCalls(spy)).toBe(6);
  });

  it("failures far apart are no streak: each one leaves the next render free to retry", async () => {
    deployed();
    const time = clock();
    const spy = serve(() => new Response(null, { status: 503 }));
    const paths = ["/frames/m15pw/loyaltyup.png"];
    await expect(preloadFrameAssets(paths)).rejects.toThrow(FrameAssetUnavailableError);
    time.advance(5 * 60_000);
    await expect(preloadFrameAssets(paths)).rejects.toThrow(FrameAssetUnavailableError);
    await expect(preloadFrameAssets(paths)).rejects.toThrow(FrameAssetUnavailableError);
    // Five minutes apart: the second failure started a new streak, so the
    // third render still asked the CDN.
    expect(cdnCalls(spy)).toBe(3);
  });

  it("a 404 is the deployment saying the file isn't there: cached, a master falls back to the default template's, a plate draws none", async () => {
    deployed();
    const spy = serve(() => new Response(null, { status: 404 }));
    await preloadFrame("not-a-real-template", "g");
    expect(getFrameDataUrl("not-a-real-template", "g")).toBe(dataUrl(M15_G));
    await preloadFrameAssets(["/frames/not-a-real-template/pt/g.png"]);
    expect(getPlateDataUrlForPath("/frames/not-a-real-template/pt/{color}.png", "g")).toBeNull();
    const before = cdnCalls(spy);
    await preloadFrame("not-a-real-template", "g");
    await preloadFrameAssets(["/frames/not-a-real-template/pt/g.png"]);
    expect(cdnCalls(spy)).toBe(before);
    await expect(loadFrameMasterBytes("not-a-real-template", "g")).resolves.toBeNull();
  });

  it("a 404 beside a failure that may pass is no miss", async () => {
    deployed();
    clock();
    vi.stubEnv("RENDER_ASSET_ORIGIN", "https://busy.example");
    const spy = serve((url) =>
      url.startsWith("https://busy.example") ? new Response(null, { status: 503 }) : new Response(null, { status: 404 }),
    );
    await expect(preloadFrame("agclassic", "g")).rejects.toBeInstanceOf(FrameAssetUnavailableError);
    await expect(preloadFrame("agclassic", "g")).rejects.toBeInstanceOf(FrameAssetUnavailableError);
    expect(spy.mock.calls.filter(([url]) => String(url).startsWith("https://busy.example"))).toHaveLength(2);
  });

  it("an EMPTY public/frames folder is no checkout: the git assets still come from the CDN", async () => {
    // A deployment that ever carried the folder (next.config.ts keeps it
    // out — pinned below) must not read every git master as missing.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pipglyph-empty-frames-"));
    fs.mkdirSync(path.join(root, "public", "frames"), { recursive: true });
    deployed();
    vi.spyOn(process, "cwd").mockReturnValue(root);
    const spy = serve((url) => (url === "https://cdn.example/frames/agclassic/g.png" ? pngAnswer(ALPHA_G) : new Response(null, { status: 404 })));
    await preloadFrame("agclassic", "g");
    expect(getFrameDataUrl("agclassic", "g")).toBe(dataUrl(ALPHA_G));
    expect(cdnCalls(spy)).toBe(1);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("loadFrameMasterBytes (the art-window check on a layout save) throws on a CDN failure instead of reading the master as missing", async () => {
    deployed();
    serve(() => new Response(null, { status: 503 }));
    await expect(loadFrameMasterBytes("agclassic", "g")).rejects.toBeInstanceOf(FrameAssetUnavailableError);
  });

  it("a file absent from a local frames folder is absent — nothing is fetched (a checkout, CI, a test)", async () => {
    const spy = serve(() => new Response(null, { status: 503 }));
    await preloadFrameAssets(["/frames/not-a-real-template/pt/g.png"]);
    expect(getPlateDataUrlForPath("/frames/not-a-real-template/pt/{color}.png", "g")).toBeNull();
    await preloadFrame("not-a-real-template", "g");
    expect(getFrameDataUrl("not-a-real-template", "g")).toBe(dataUrl(M15_G));
    expect(cdnCalls(spy)).toBe(0);
    expect(spy.mock.calls.every(([url]) => String(url) === m15Url)).toBe(true);
  });
});
