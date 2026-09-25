// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ImageResponse } from "next/og";
import { CardPreview } from "@/components/cards/card-preview";
import { EtchedSheen } from "@/lib/cards/etched-finish";
import { setFrameStorageForTests, type FrameManifest } from "@/lib/frames/frame-url";

// ---------------------------------------------------------------------------
// Etched finish (layout v25): ONE shared SVG (lib/cards/etched-finish.tsx)
// in the preview and the bake, masked by the frame's own luminance. The old
// overlay was a Fragment in the bake — Satori laid it out as a zero-width
// flex item, so the "3% inset gold border" baked as an 18 px strip down the
// card's left edge, and its `inset: 0` cross-hatch never painted at all.
// ---------------------------------------------------------------------------

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

const entry = (c: string) => ({ hash: c.repeat(12), sha256: c.repeat(64), bytes: 1, width: 1, height: 1 });
const MANIFEST: FrameManifest = {
  version: 1,
  bucket: "frames",
  files: { "m15/u.png": entry("1"), "m15/u.webp": entry("2") },
};

let restore: () => void = () => {};
afterEach(() => {
  restore();
  cleanup();
});

describe("etched finish — preview", () => {
  it("masks the sheen with the SAME frame object the face paints, and draws no inset border", () => {
    restore = setFrameStorageForTests({ manifest: MANIFEST, origin: "https://b.example/frames" });
    const { container } = render(
      <CardPreview
        title="Etched Test"
        cardType="instant"
        colorIdentity={["blue"]}
        frameStyle={{ template: "m15", finish: "etched" }}
      />,
    );
    const masks = container.querySelectorAll("mask");
    expect(masks).toHaveLength(1);
    const href = masks[0].querySelector("image")?.getAttribute("href");
    expect(href).toBe("https://b.example/frames/m15/u.222222222222.webp");
    // The mask id is referenced from the same SVG, and is url()-safe.
    const id = masks[0].getAttribute("id") ?? "";
    expect(id).toMatch(/^etched-[A-Za-z0-9_-]+-frame$/);
    expect(container.querySelector(`g[mask="url(#${id})"]`)).not.toBeNull();
    expect(container.innerHTML).not.toContain("inset-[3%]");
    expect(container.innerHTML).not.toContain("border-image");
  });

  it("renders nothing etched for other finishes", () => {
    const { container } = render(
      <CardPreview title="Plain" cardType="instant" colorIdentity={["blue"]} frameStyle={{ template: "m15" }} />,
    );
    expect(container.querySelector("mask")).toBeNull();
  });
});

describe("etched finish — bake", () => {
  it("draws the shared SVG right after the frame, never inside a Fragment", () => {
    const bake = read("lib/render/card-image.tsx");
    const frameImg = bake.indexOf("src={frameDataUrl}");
    const sheen = bake.indexOf("<EtchedSheen");
    expect(frameImg).toBeGreaterThan(0);
    expect(sheen).toBeGreaterThan(frameImg);
    expect(bake.slice(frameImg, sheen)).not.toContain("<Band");
    expect(bake).not.toContain("#d4a64a");
  });

  it("texturises the frame's lit pixels only: black border and art window stay untouched", async () => {
    // Synthetic 60×84 "frame": opaque black border, opaque light interior,
    // transparent art window — the three cases the luminance mask separates.
    const W = 60;
    const H = 84;
    const px = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const i = (y * W + x) * 4;
        const border = x < 6 || x >= W - 6 || y < 6 || y >= H - 6;
        const window = x >= 18 && x < 42 && y >= 18 && y < 42;
        const v = border ? 0 : 200;
        px.set([v, v, v, window ? 0 : 255], i);
      }
    }
    const sharp = (await import("sharp")).default;
    const png = await sharp(Buffer.from(px), { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
    const frame = `data:image/png;base64,${png.toString("base64")}`;
    const card = (etched: boolean) => (
      <div style={{ display: "flex", width: "100%", height: "100%", position: "relative", background: "#101015" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={frame} alt="" style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }} />
        {etched ? <EtchedSheen id="t" frameHref={frame} width={1500} height={2100} /> : null}
      </div>
    );
    const raw = async (etched: boolean) => {
      const res = new ImageResponse(card(etched), { width: 1500, height: 2100 });
      return sharp(Buffer.from(await res.arrayBuffer())).raw().toBuffer();
    };
    const [plain, etched] = await Promise.all([raw(false), raw(true)]);
    const delta = (x0: number, y0: number, x1: number, y1: number) => {
      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const i = (y * 1500 + x) * 4;
          sum += Math.abs(etched[i] - plain[i]);
          n += 1;
        }
      }
      return sum / n;
    };
    expect(delta(10, 300, 120, 1800)).toBe(0); // black border (x < 150 HD px)
    expect(delta(500, 500, 1000, 1000)).toBe(0); // art window
    expect(delta(200, 1300, 1300, 1900)).toBeGreaterThan(1); // lit frame
    expect(delta(0, 0, 18, 2100)).toBe(0); // the old left-edge strip
  }, 60_000);
});
