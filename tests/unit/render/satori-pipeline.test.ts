import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// TODO 6.16a guards. Node-runtime Satori renders go through
// lib/render/satori-png.ts, whose asset loader never touches the network;
// next/og's ImageResponse hard-wires one that fetches Google Fonts and
// Twemoji at render time. Two things keep that true:
//   * satori is pinned to the exact version next/og bundles, so moving off
//     ImageResponse changed no pixels (proven on every public production
//     card when it landed) — bump both together when Next is upgraded;
//   * only the edge brand images still import next/og (fixed copy only).
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "../../..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("satori pipeline", () => {
  it("pins satori to the exact version next/og bundles", () => {
    const pinned = (JSON.parse(read("package.json")) as { dependencies: Record<string, string> }).dependencies
      .satori;
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
    const bundled = read("node_modules/next/dist/compiled/@vercel/og/index.node.js").match(
      /node_modules\/\.pnpm\/satori@(\d+\.\d+\.\d+)\//,
    )?.[1];
    expect(bundled, "next/og's bundled satori — bump package.json's satori to match").toBe(pinned);
    expect((JSON.parse(read("node_modules/satori/package.json")) as { version: string }).version).toBe(pinned);
  });

  it("only the edge brand images import next/og", () => {
    const EDGE_BRAND_IMAGES = [
      "app/apple-icon.tsx",
      "app/icon.tsx",
      "app/opengraph-image.tsx",
      "app/twitter-image.tsx",
    ];
    const importers = ["app", "components", "lib"]
      .flatMap((dir) => sourceFiles(path.join(ROOT, dir)))
      .filter((file) => /from\s+["']next\/og["']/.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(ROOT, file))
      .sort();
    expect(importers).toEqual(EDGE_BRAND_IMAGES);
    for (const file of EDGE_BRAND_IMAGES) expect(read(file)).toMatch(/export const runtime = "edge"/);
  });

  it("the bundled Noto fallback ships beside its licence and stays a subset", () => {
    expect(read("public/fonts/NotoSans-OFL.txt")).toMatch(/SIL Open Font License/);
    // Traced into every render function: keep it a subset, not all of Noto.
    expect(statSync(path.join(ROOT, "public/fonts/NotoSans-Fallback.ttf")).size).toBeLessThan(250_000);
  });

  it("the node OG images can read next/og's default face where lib/og/image-response.ts looks", () => {
    // Moved by a Next upgrade? Point NEXT_OG_DEFAULT_FONT_PATH at it again.
    expect(statSync(path.join(ROOT, "node_modules/next/dist/compiled/@vercel/og/Geist-Regular.ttf")).size).toBeGreaterThan(0);
    expect(read("lib/og/image-response.ts")).toMatch(/"next",\s*"dist",\s*"compiled",\s*"@vercel",\s*"og",\s*"Geist-Regular\.ttf"/);
  });
});
