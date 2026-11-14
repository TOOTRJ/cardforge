import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// The pictures a restyle starts from (Re-art deck, 0212), fetched by the
// SERVER — so each is held to an address the server may fetch:
//
//   * a card's own stored art (lib/tools/re-art/restyle-source.ts): the
//     column is its owner's to write, so only the app's own storage (and
//     Scryfall) is ever requested — never an address a card names;
//   * a printing's art (lib/scryfall/art-crop.ts fetchScryfallArtCrop):
//     the ART CROP alone, never the print scan (a restyle of a whole card
//     would repaint its frame and text), charged to the caller's art quota
//     only once a picture resolved, and never stored (the module holds no
//     storage writer: the one that stores a printing's picture is
//     import-art.ts, whose callers count an upload).
// ---------------------------------------------------------------------------

const m = vi.hoisted(() => ({
  fetchImage: vi.fn(),
  log: vi.fn(),
  quality: vi.fn(),
}));

vi.mock("@/lib/scryfall/client", () => ({ fetchScryfallImage: m.fetchImage, assessPrintImageQuality: m.quality }));
vi.mock("@/lib/scryfall/rate-limit", () => ({ logScryfallCall: m.log }));

import { fetchStoredArt } from "@/lib/tools/re-art/restyle-source";
import { fetchScryfallArtCrop } from "@/lib/scryfall/art-crop";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ScryfallCard } from "@/lib/scryfall/client";

const OWN = "https://x.supabase.co/storage/v1/object/public/card-art/u1/mine.png";
const answer = (body: Uint8Array, contentType = "image/png", ok = true) =>
  ({ ok, headers: new Headers({ "content-type": contentType }), arrayBuffer: async () => body.buffer }) as unknown as Response;

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co");
  m.quality.mockReturnValue("ok");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("a card's own stored art", () => {
  it("is fetched from the app's own storage, as the image it is", async () => {
    const fetched = vi.fn(async (...args: [string, RequestInit?]) => answer(new Uint8Array([1, 2, 3, args.length])));
    vi.stubGlobal("fetch", fetched);
    const art = await fetchStoredArt(OWN);
    expect(art).toEqual({ bytes: new Uint8Array([1, 2, 3, 2]), contentType: "image/png" });
    expect(fetched).toHaveBeenCalledTimes(1);
    expect(fetched.mock.calls[0][0]).toBe(OWN);
  });

  it("an address the server may not fetch is never requested: another host, plain http, a site path, nothing", async () => {
    const fetched = vi.fn(async () => answer(new Uint8Array([1])));
    vi.stubGlobal("fetch", fetched);
    for (const address of [
      "https://elsewhere.example/art.png",
      "http://x.supabase.co/storage/v1/object/public/card-art/u1/mine.png",
      "https://pipglyph.com/defaults/avatars/avatar-18.webp",
      "/defaults/avatars/avatar-18.webp",
      "file:///etc/passwd",
      "",
      null,
      undefined,
    ]) {
      expect(await fetchStoredArt(address)).toBeNull();
    }
    expect(fetched).not.toHaveBeenCalled();
  });

  it("anything but a picture is no art: a refused request, a page, nothing at all, a failed connection", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer(new Uint8Array([1]), "image/png", false)));
    expect(await fetchStoredArt(OWN)).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => answer(new Uint8Array([1]), "text/html")));
    expect(await fetchStoredArt(OWN)).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => answer(new Uint8Array())));
    expect(await fetchStoredArt(OWN)).toBeNull();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connect ETIMEDOUT");
      }),
    );
    expect(await fetchStoredArt(OWN)).toBeNull();
  });
});

describe("a printing's art", () => {
  const CROP = "https://cards.scryfall.io/art_crop/front/8/2/824b.jpg";
  const BACK = "https://cards.scryfall.io/art_crop/back/8/2/824b.jpg";
  const card = (over: Partial<ScryfallCard> = {}) =>
    ({ id: "sf-1", name: "Krenko, Mob Boss", image_uris: { art_crop: CROP, normal: "https://cards.scryfall.io/normal/front/8/2/824b.jpg" }, ...over }) as ScryfallCard;
  const picture = (bytes = [5, 5]) => ({ blob: new Blob([new Uint8Array(bytes)]), contentType: "image/jpeg" });

  it("is the art crop — never the print scan — charged to the art quota once it resolved, and never stored", async () => {
    m.fetchImage.mockResolvedValue(picture());
    const art = await fetchScryfallArtCrop("u1", card(), "front");
    expect(art).toEqual({ ok: true, bytes: new Uint8Array([5, 5]), contentType: "image/jpeg" });
    expect(m.fetchImage).toHaveBeenCalledWith(CROP);
    expect(m.log).toHaveBeenCalledWith("u1", "import_art");
    // Never stored: the module holds no storage writer at all.
    const source = readFileSync(join(process.cwd(), "lib/scryfall/art-crop.ts"), "utf8");
    expect(source).not.toMatch(/user-storage|userFolder|\.upload\(|createAdminClient/);
  });

  it("a printing with only a print scan has no art to restyle: nothing is fetched or charged", async () => {
    const result = await fetchScryfallArtCrop("u1", card({ image_uris: { normal: "https://cards.scryfall.io/normal/front/8/2/824b.jpg" } } as Partial<ScryfallCard>), "front");
    expect(result).toEqual({ ok: false, error: "Scryfall has no art for this card to restyle." });
    expect(m.fetchImage).not.toHaveBeenCalled();
    expect(m.log).not.toHaveBeenCalled();
  });

  it("a double-faced card's faces each have their own art; a card with one face has no back", async () => {
    m.fetchImage.mockResolvedValue(picture());
    const dfc = card({ image_uris: undefined, card_faces: [{ image_uris: { art_crop: CROP } }, { image_uris: { art_crop: BACK } }] } as Partial<ScryfallCard>);
    await fetchScryfallArtCrop("u1", dfc, "front");
    await fetchScryfallArtCrop("u1", dfc, "back");
    expect(m.fetchImage.mock.calls.map(([address]) => address)).toEqual([CROP, BACK]);
    m.log.mockClear();
    expect(await fetchScryfallArtCrop("u1", card(), "back")).toEqual({ ok: false, error: "This card has no back face." });
    expect(m.log).not.toHaveBeenCalled();
  });

  it("a placeholder scan, a download that fails and an empty file are each said, never repainted", async () => {
    m.quality.mockReturnValueOnce("unusable");
    expect(await fetchScryfallArtCrop("u1", card(), "front")).toMatchObject({ ok: false, error: expect.stringMatching(/placeholder image/) });
    expect(m.fetchImage).not.toHaveBeenCalled();
    m.fetchImage.mockResolvedValueOnce(null);
    expect(await fetchScryfallArtCrop("u1", card(), "front")).toMatchObject({ ok: false, error: expect.stringMatching(/Could not download/) });
    m.fetchImage.mockResolvedValueOnce(picture([]));
    expect(await fetchScryfallArtCrop("u1", card(), "front")).toMatchObject({ ok: false, error: expect.stringMatching(/can't be used/) });
  });
});
