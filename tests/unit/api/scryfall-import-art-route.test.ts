import { beforeEach, describe, expect, it, vi } from "vitest";
import printings from "../scryfall/fixtures/import-printings.json";

// ---------------------------------------------------------------------------
// POST /api/scryfall/import-art (TODO 1.8):
//   • the user's Scryfall quota is charged only once the face AND its image
//     URL resolve — "no back face" and "no image" (a split / adventure /
//     flip card asked for back-face art) cost nothing; the placeholder gate
//     still refuses first;
//   • the response names the REQUESTED face's artist.
// Network (Scryfall lookup + image download) and Storage are mocked; the
// payloads are real (trimmed) Scryfall printings.
// ---------------------------------------------------------------------------

const USER_ID = "0f5c3a52-1b1e-4c55-9d7e-2f3a4b5c6d7e";

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  check: vi.fn(),
  log: vi.fn(),
  byId: vi.fn(),
  image: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => state.user,
}));
// The import lands in the caller's card-art folder through the service role
// (lib/media/user-storage.ts — users hold no storage write policy, 0126).
vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => true,
  createAdminClient: () => ({
    // The upload limit (0127, fail-closed) answers "allowed"; the storage
    // origin registration (lib/media/storage-origin.ts) is a no-op upsert.
    rpc: async () => ({ data: [{ allowed: true, retry_after_seconds: 0, limited_by: null }], error: null }),
    from: () => ({ upsert: async () => ({ error: null }) }),
    storage: {
      from: () => ({
        upload: state.upload,
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://cdn.example/card-art/${path}` },
        }),
      }),
    },
  }),
}));
vi.mock("@/lib/scryfall/rate-limit", () => ({
  checkScryfallRateLimit: state.check,
  logScryfallCall: state.log,
}));
vi.mock("@/lib/scryfall/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/scryfall/client")>()),
  getCardById: state.byId,
  fetchScryfallImage: state.image,
}));

import { POST } from "@/app/api/scryfall/import-art/route";
import { scryfallCardSchema } from "@/lib/scryfall/client";

type PrintingKey = keyof typeof printings;
const card = (key: PrintingKey) => scryfallCardSchema.parse(printings[key]);

function post(body: unknown) {
  return POST(
    new Request("https://www.pipglyph.com/api/scryfall/import-art", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const ID = "11bf83bb-c95b-4b4f-9a56-ce7a1816307a";

beforeEach(() => {
  state.user = { id: USER_ID };
  state.check.mockReset().mockResolvedValue({ ok: true });
  state.log.mockReset().mockResolvedValue(undefined);
  state.byId.mockReset();
  state.image
    .mockReset()
    .mockResolvedValue({ blob: new Blob([new Uint8Array(8)], { type: "image/jpeg" }), contentType: "image/jpeg" });
  state.upload.mockReset().mockResolvedValue({ error: null });
});

describe("POST /api/scryfall/import-art — the quota is charged after the image resolves", () => {
  it("a split / adventure / aftermath card's back face has no image: 404, nothing charged, nothing fetched", async () => {
    for (const key of ["eld-115", "dmr-215", "akh-211"] as const) {
      state.byId.mockResolvedValue(card(key));
      const res = await post({ scryfallId: ID, mode: "art-back" });
      expect(res.status, key).toBe(404);
      expect((await res.json()).error).toBe("Scryfall has no image for this card.");
    }
    expect(state.log).not.toHaveBeenCalled();
    expect(state.image).not.toHaveBeenCalled();
  });

  it("a single-faced card has no back face: 404, nothing charged", async () => {
    state.byId.mockResolvedValue(card("dom-168"));
    const res = await post({ scryfallId: ID, mode: "art-back" });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("This card has no back face.");
    expect(state.log).not.toHaveBeenCalled();
  });

  it("a placeholder scan is still refused before anything is charged", async () => {
    state.byId.mockResolvedValue({ ...card("isd-51"), image_status: "placeholder" });
    const res = await post({ scryfallId: ID, mode: "art" });
    expect(res.status).toBe(422);
    expect(state.log).not.toHaveBeenCalled();
  });

  it("charges once the URL resolves — the DFC back face (Delver ISD #51)", async () => {
    state.byId.mockResolvedValue(card("isd-51"));
    const res = await post({ scryfallId: ID, mode: "art-back" });
    expect(res.status).toBe(200);
    expect(state.log).toHaveBeenCalledWith(USER_ID, "import_art");
    expect(state.image).toHaveBeenCalledWith(
      expect.stringContaining("/art_crop/back/"),
    );
    expect((await res.json()).artist).toBe("Nils Hamm");
  });

  it("charges a resolved URL even when the download then fails (the lookup was real)", async () => {
    state.byId.mockResolvedValue(card("eld-115"));
    state.image.mockResolvedValue(null);
    const res = await post({ scryfallId: ID, mode: "art" });
    expect(res.status).toBe(502);
    expect(state.log).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/scryfall/import-art — the requested face's artist", () => {
  it("names the front face's artist, not the card's joined credit", async () => {
    // Fire // Ice DMR #215: "David Martin & Franz Vohwinkel" on the card.
    state.byId.mockResolvedValue(card("dmr-215"));
    const res = await post({ scryfallId: ID, mode: "art" });
    expect(res.status).toBe(200);
    expect((await res.json()).artist).toBe("David Martin");
  });

  it("names the back face's own artist for a back-face import", async () => {
    const dfc = scryfallCardSchema.parse({
      id: ID,
      name: "Front // Back",
      artist: "Front Artist & Back Artist",
      card_faces: [
        { name: "Front", artist: "Front Artist", image_uris: { art_crop: "https://cards.scryfall.io/art_crop/front/x.jpg" } },
        { name: "Back", artist: "Back Artist", image_uris: { art_crop: "https://cards.scryfall.io/art_crop/back/x.jpg" } },
      ],
    });
    state.byId.mockResolvedValue(dfc);
    expect((await (await post({ scryfallId: ID, mode: "art-back" })).json()).artist).toBe("Back Artist");
    expect((await (await post({ scryfallId: ID, mode: "art" })).json()).artist).toBe("Front Artist");
  });

  it("a single-faced card names its card-level artist", async () => {
    state.byId.mockResolvedValue({
      ...card("unh-107"),
      image_uris: { art_crop: "https://cards.scryfall.io/art_crop/front/x.jpg" },
    });
    expect((await (await post({ scryfallId: ID, mode: "art" })).json()).artist).toBe("Greg Hildebrandt");
  });

  it("an adventure (one image) names its front face's artist", async () => {
    state.byId.mockResolvedValue(card("eld-115"));
    expect((await (await post({ scryfallId: ID, mode: "art" })).json()).artist).toBe("Victor Adame Minguez");
  });
});

describe("POST /api/scryfall/import-art — where the art lands (migration 0126)", () => {
  it("in the caller's own card-art folder, under a name the server made up, via the service role", async () => {
    state.byId.mockResolvedValue(card("dmr-215"));
    const res = await post({ scryfallId: ID, mode: "art", path: "someone-else/x.jpg", userId: "someone-else" });
    expect(res.status).toBe(200);
    expect(state.upload).toHaveBeenCalledTimes(1);
    const [key, , options] = state.upload.mock.calls[0];
    expect(key).toMatch(new RegExp(`^${USER_ID}/[0-9a-f-]{36}\\.jpg$`));
    expect(options).toMatchObject({ contentType: "image/jpeg", upsert: false });
    expect((await res.json()).publicUrl).toBe(`https://cdn.example/card-art/${key}`);
  });

  it("a signed-out caller never reaches storage", async () => {
    state.user = null;
    const res = await post({ scryfallId: ID, mode: "art" });
    expect(res.status).toBe(401);
    expect(state.upload).not.toHaveBeenCalled();
  });
});
