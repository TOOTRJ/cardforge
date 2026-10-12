import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";
import { compareRegion, differenceMap, prepare, tileMap, worstTile, type Rgb } from "./compare";
import { baselineKey, judge, searchRadius, tileSize, type Measured } from "./thresholds";
import { DIR, FRAMES_DIR, MEASURE, ROOT, SAVE, loadCases, recorded } from "./run";
import {
  PARITY_ART_FILE,
  PARITY_BACKDROP,
  PARITY_FRAME_ORIGIN,
  PARITY_PATH,
  PARITY_PORT,
  PARITY_SIZES,
  PARITY_STORAGE_ORIGIN,
} from "./shared";

// ---------------------------------------------------------------------------
// The BROWSER half of the preview ⇄ bake parity suite (TODO 3.11): mounts
// every case the bake stage left in tmp/parity/cases-*.json in the real
// CardPreview (app/dev/parity), screenshots it at the bake's pixel size and
// holds each region to tests/parity/thresholds.ts. One Playwright project
// per compared size ("750", "hd" — tests/parity/playwright.config.ts), each
// in its own worker with its own page, so the two sizes run side by side.
//
// What the page loads is answered here, from disk:
//   * frames — the PNG masters the bake read (the visual suite's cache for
//     bucket frames, public/frames for the ones in git). The preview asks
//     for the .webp sibling; it is given the PNG master, so the comparison
//     is of the two RENDERERS, not of the WebP encode;
//   * the art — the bake stage's pictures, from the harness's storage URLs;
//   * anything else off this machine is refused, and an image or font
//     request that fails fails the case.
// ---------------------------------------------------------------------------

const LOCAL = `http://localhost:${PARITY_PORT}`;
const cases = loadCases();

type Manifest = { files: Record<string, { hash: string }> };
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "lib/frames/frame-manifest.json"), "utf8")) as Manifest;

/** "m15/w.png" → the bucket object's file in the frame cache, or null. */
function cachedMaster(key: string): string | null {
  const entry = manifest.files[key];
  if (!entry) return null;
  const dot = key.lastIndexOf(".");
  const file = path.join(FRAMES_DIR, `${key.slice(0, dot)}.${entry.hash}${key.slice(dot)}`);
  return fs.existsSync(file) ? file : null;
}

/** The PNG master for a frame the page asked for: `key` is the manifest key
 *  ("m15/w.webp" or ".png"). Bucket masters come from the cache, the ones
 *  still in git from public/frames. */
function masterFor(key: string): string | null {
  if (key.includes("..")) return null;
  const png = key.replace(/\.webp$/, ".png");
  const local = path.join(ROOT, "public/frames", png);
  return cachedMaster(png) ?? (fs.existsSync(local) ? local : null);
}

/** A bucket object key ("m15/w.3fa9c2d1e0ab.webp") → its manifest key. */
function manifestKeyOf(objectKey: string): string {
  return objectKey.replace(/\.[0-9a-f]{12}(\.[a-z0-9]+)$/, "$1");
}

type Net = { pending: number; problems: string[] };

async function answer(route: Route, net: Net): Promise<void> {
  const request = route.request();
  const url = request.url();
  const png = (file: string) => route.fulfill({ status: 200, contentType: "image/png", body: fs.readFileSync(file) });
  if (url.startsWith(`${PARITY_FRAME_ORIGIN}/`)) {
    const file = masterFor(manifestKeyOf(decodeURIComponent(new URL(url).pathname.slice(1))));
    if (file) return png(file);
    net.problems.push(`frame not in the cache: ${url}`);
    return route.fulfill({ status: 404, body: "" });
  }
  if (url.startsWith(`${PARITY_STORAGE_ORIGIN}/`)) {
    const name = /\/card-art\/[0-9a-f-]+\/([^/]+)$/.exec(new URL(url).pathname)?.[1];
    if (name && PARITY_ART_FILE.test(name)) {
      return route.fulfill({
        status: 200,
        contentType: name.endsWith(".jpg") ? "image/jpeg" : "image/png",
        body: fs.readFileSync(path.join(DIR, "art", name)),
      });
    }
    // The root layout's islands asking a Supabase that is not there.
    return route.abort();
  }
  if (url.startsWith(`${LOCAL}/`)) {
    const frame = /^\/frames\/(.+\.webp)$/.exec(decodeURIComponent(new URL(url).pathname))?.[1];
    const file = frame ? masterFor(frame) : null;
    if (file) return png(file);
    return route.continue();
  }
  if (url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
  if (["image", "font", "stylesheet"].includes(request.resourceType())) net.problems.push(`refused (off this machine): ${url}`);
  return route.abort();
}

async function rgbOf(png: Buffer): Promise<Rgb> {
  const { data, info } = await sharp(png).flatten({ background: PARITY_BACKDROP }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** Waits until the card has drawn everything it will: no image or font
 *  request in flight, every face loaded, every <img> decoded, and the same
 *  again one frame later (the foil mask is drawn from the art's size, which
 *  an effect reads after the art has loaded). */
async function settle(page: Page, net: Net): Promise<void> {
  const deadline = Date.now() + 45_000;
  let calm = 0;
  while (calm < 2) {
    if (Date.now() > deadline) throw new Error(`the preview did not settle (${net.pending} request(s) in flight)`);
    const state = await page.evaluate(async () => {
      await document.fonts.ready;
      const imgs = [...document.querySelectorAll<HTMLImageElement>("#parity-card img")];
      await Promise.all(imgs.map((img) => (img.complete ? img.decode().catch(() => undefined) : new Promise((r) => img.addEventListener("load", r, { once: true })))));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return {
        mounted: Boolean(document.querySelector("#parity-card > *")),
        fonts: document.fonts.status,
        broken: imgs.filter((img) => !img.complete || img.naturalWidth === 0).map((img) => img.currentSrc || img.src),
      };
    });
    if (state.broken.length) throw new Error(`the preview has a picture that did not load: ${state.broken.join(", ").slice(0, 300)}`);
    calm = state.mounted && state.fonts === "loaded" && net.pending === 0 ? calm + 1 : 0;
  }
}

let context: BrowserContext;
let page: Page;
let size: (typeof PARITY_SIZES)[number];
const net: Net = { pending: 0, problems: [] };

test.beforeAll(async ({ browser }, testInfo) => {
  const found = PARITY_SIZES.find((s) => s.name === testInfo.project.name);
  if (!found) throw new Error(`no parity size "${testInfo.project.name}" — run through \`npm run test:parity\``);
  size = found;
  // Room for a portrait card (750 × 1050) and a landscape one (1050 × 750).
  context = await browser.newContext({ viewport: { width: 1100, height: 1100 }, deviceScaleFactor: size.scale, reducedMotion: "reduce" });
  page = await context.newPage();
  const tracked = (type: string) => type === "image" || type === "font" || type === "stylesheet";
  page.on("request", (r) => {
    if (tracked(r.resourceType())) net.pending += 1;
  });
  const done = (type: string) => {
    if (tracked(type)) net.pending -= 1;
  };
  page.on("requestfinished", (r) => done(r.resourceType()));
  page.on("requestfailed", (r) => {
    done(r.resourceType());
    // An aborted Supabase call of a layout island is expected; a picture
    // or a font of the CARD that fails is not.
    if (tracked(r.resourceType()) && !r.url().startsWith(PARITY_STORAGE_ORIGIN)) net.problems.push(`failed: ${r.url()}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 400 && tracked(r.request().resourceType())) net.problems.push(`${r.status()}: ${r.url()}`);
  });
  await page.route("**/*", (route) => answer(route, net));
  await page.goto(PARITY_PATH, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("html[data-parity-ready='1']", { timeout: 120_000 });
  // Next's dev badge is not the card.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  // A first card, drawn and thrown away: the first screenshot of a page
  // measured a hair differently from every later one of the same card
  // (2026-10-12: one region's `hot` by 0.001, locally and on CI) — fonts
  // and the compositor are warm from here on.
  if (cases.length) {
    const first = cases[0];
    await page.evaluate(({ card, face }) => window.__parity!.show({ key: "warm-up", card: card as never, face, width: 750 }), {
      card: first.card,
      face: first.face,
    });
    await settle(page, net);
    await page.screenshot({ clip: { x: 0, y: 0, width: 750, height: 750 }, animations: "disabled", scale: "device" });
    net.problems.length = 0;
  }
});

test.afterAll(async () => {
  await context?.close();
});

for (const c of cases) {
  test(c.id, async () => {
    net.problems.length = 0;
    const landscape = c.orientation === "landscape";
    const cssW = landscape ? Math.round((size.cssWidth * 7) / 5) : size.cssWidth;
    const cssH = landscape ? size.cssWidth : Math.round((size.cssWidth * 7) / 5);
    await page.evaluate(
      ({ key, card, face, width }) => {
        // Unmount first: the next case never inherits a mounted flip.
        window.__parity!.show(null);
        window.__parity!.show({ key, card: card as never, face, width });
      },
      { key: `${c.id}@${size.name}`, card: c.card, face: c.face, width: cssW },
    );
    await settle(page, net);
    const shot = await page.screenshot({ clip: { x: 0, y: 0, width: cssW, height: cssH }, animations: "disabled", caret: "hide", scale: "device" });
    expect(net.problems, "every picture and font of the card must load").toEqual([]);

    const bakePng = fs.readFileSync(path.join(DIR, "bake", `${c.file}@${size.name}.png`));
    const [bake, preview] = await Promise.all([rgbOf(bakePng), rgbOf(shot)]);
    expect({ width: preview.width, height: preview.height }, "the preview and the bake are the same size").toEqual({
      width: bake.width,
      height: bake.height,
    });

    const prepared = prepare(bake, preview);
    const radius = searchRadius(size.name);
    const tiles = tileMap(prepared, tileSize(size.name));
    const measured: Measured = {
      id: c.id,
      size: size.name,
      regions: Object.fromEntries(
        c.regions.map((r) => [
          r.name,
          compareRegion(prepared, { x: r.x * bake.width, y: r.y * bake.height, w: r.w * bake.width, h: r.h * bake.height }, { radius }),
        ]),
      ),
      card: compareRegion(prepared, { x: 0, y: 0, w: bake.width, h: bake.height }, { radius: 0 }),
      tile: worstTile(tiles),
      tiles,
      rects: Object.fromEntries(c.regions.map((r) => [r.name, { x: r.x, y: r.y, w: r.w, h: r.h }])),
    };
    // A measuring run (and an update) is held to the limits only: its
    // baseline is the thing being replaced.
    const failures = judge(measured, recorded && !MEASURE ? recorded[baselineKey(measured)] : null);

    fs.mkdirSync(path.join(DIR, "results"), { recursive: true });
    fs.writeFileSync(path.join(DIR, "results", `${c.file}@${size.name}.json`), `${JSON.stringify({ ...measured, why: c.why, failures }, null, 1)}\n`);
    if (SAVE || failures.length) {
      const out = path.join(DIR, "out");
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(path.join(out, `${c.file}@${size.name}.preview.png`), shot);
      fs.copyFileSync(path.join(DIR, "bake", `${c.file}@${size.name}.png`), path.join(out, `${c.file}@${size.name}.bake.png`));
      await sharp(Buffer.from(differenceMap(prepared)), { raw: { width: bake.width, height: bake.height, channels: 1 } })
        .png()
        .toFile(path.join(out, `${c.file}@${size.name}.diff.png`));
    }
    if (!MEASURE) expect(failures, `preview ⇄ bake: ${c.id} @${size.name} — ${c.why}`).toEqual([]);
  });
}
