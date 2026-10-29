import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { OgDeckHero, type OgFanCard } from "@/lib/og/chrome";
import { DEFAULT_DECK_COVERS } from "@/lib/decks/cover";
import { renderDeckShareImage } from "@/lib/og/deck-share-image";
import { toSatoriDataUrl } from "@/lib/render/art-source";

// ---------------------------------------------------------------------------
// TODO DK6.6: the deck share image stays under WhatsApp's 600 KB — the cap
// the card's social image is held to (app/api/cards/[id]/og/route.ts). Its
// PNG was 596–728 KB on a default background with five cards, and 1.2–1.5
// MB on a busy upload; the JPEG must hold every one of the 16 defaults with
// a full fan of five, and a busy upload with five.
//
// The stand-ins are busy on purpose: each card thumb is a painted built-in
// avatar filling a 600×840 card (a real bake has flat frame and text-box
// areas, so it encodes smaller), and the upload is a mosaic of six of them
// at the 1600×900 cover size.
// ---------------------------------------------------------------------------

const CAP = 600 * 1024;
const PUBLIC = path.join(process.cwd(), "public");
const avatar = (n: number) => readFileSync(path.join(PUBLIC, `defaults/avatars/avatar-${String(n).padStart(2, "0")}.webp`));

let fan: OgFanCard[] = [];
let busyUpload = "";

beforeAll(async () => {
  fan = await Promise.all(
    [3, 7, 11, 16, 21].map(async (n) => ({
      src: await toSatoriDataUrl(await sharp(avatar(n)).resize(600, 840, { fit: "cover" }).webp({ quality: 80 }).toBuffer()),
      landscape: false,
    })),
  );
  const tiles = await Promise.all(
    [1, 5, 9, 13, 17, 22].map(async (n, i) => ({
      input: await sharp(avatar(n)).resize(534, 450, { fit: "cover" }).toBuffer(),
      left: (i % 3) * 533,
      top: Math.floor(i / 3) * 450,
    })),
  );
  const mosaic = await sharp({ create: { width: 1600, height: 900, channels: 3, background: "#000000" } })
    .composite(tiles)
    .webp({ quality: 82 })
    .toBuffer();
  busyUpload = await toSatoriDataUrl(mosaic);
}, 60_000);

async function shareImageBytes(cover: string): Promise<Buffer> {
  return renderDeckShareImage(
    <OgDeckHero cover={cover} cards={fan} eyebrow="Commander deck" title="Krenko's Goblin Swarm" byline="by @storm_griffin" />,
  );
}

describe("the deck share image is a JPEG under 600 KB", () => {
  it.each(DEFAULT_DECK_COVERS)("on %s with a full fan of five", async (cover) => {
    const bytes = await shareImageBytes(await toSatoriDataUrl(readFileSync(path.join(PUBLIC, cover))));
    const meta = await sharp(bytes).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 1200, 630]);
    expect(bytes.byteLength, `${cover}: ${Math.round(bytes.byteLength / 1024)} KB`).toBeLessThan(CAP);
  }, 30_000);

  it("on a busy uploaded cover with a full fan of five", async () => {
    const bytes = await shareImageBytes(busyUpload);
    expect((await sharp(bytes).metadata()).format).toBe("jpeg");
    expect(bytes.byteLength, `${Math.round(bytes.byteLength / 1024)} KB`).toBeLessThan(CAP);
  }, 30_000);
});
