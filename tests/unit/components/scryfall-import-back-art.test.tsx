// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import printings from "../scryfall/fixtures/import-printings.json";
import { hasBackFaceImage, scryfallCardSchema } from "@/lib/scryfall/client";
import { mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";

// ---------------------------------------------------------------------------
// TODO 1.8, dialog half: "Also import artwork" asks for the back face's art
// only when the printing's second face HAS an image (the named route's
// has_back_image). A split, adventure, flip or aftermath card is one image:
// it used to spend an import_art call on a 404 and toast "The back-face art
// couldn't be fetched". The /api/scryfall/* routes are stubbed with what the
// real route builds from real (trimmed) Scryfall payloads.
// ---------------------------------------------------------------------------

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), message: vi.fn(), info: vi.fn() },
}));

import { toast } from "sonner";
import { ScryfallImportDialog } from "@/components/creator/scryfall-import-dialog";

type Key = keyof typeof printings;

function namedResponse(key: Key) {
  const card = scryfallCardSchema.parse(printings[key]);
  return {
    ok: true,
    card: {
      id: card.id,
      name: card.name,
      oracle_id: card.oracle_id ?? null,
      set: card.set ?? null,
      set_name: card.set_name ?? null,
      print_url: null,
      thumb_url: null,
      scryfall_uri: null,
      image_status: null,
      has_back_image: hasBackFaceImage(card),
    },
    patch: JSON.parse(JSON.stringify(mapScryfallToFormPatch(card))),
  };
}

let current: Key = "eld-115";
/** Modes /api/scryfall/import-art was asked for, in order. */
let artModes: string[] = [];
/** Whether the art route answers ok for a mode. */
let artOk: (mode: string) => boolean = () => true;

beforeEach(() => {
  artModes = [];
  artOk = () => true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (url.startsWith("/api/scryfall/search")) {
        const card = scryfallCardSchema.parse(printings[current]);
        return json({
          ok: true,
          results: [
            {
              id: card.id,
              name: card.name,
              set: card.set,
              set_name: card.set_name,
              type_line: card.type_line ?? null,
              mana_cost: null,
              rarity: card.rarity,
              artist: null,
              thumb_url: null,
              print_url: null,
              oracle_text: null,
              image_status: null,
            },
          ],
        });
      }
      if (url.startsWith("/api/scryfall/named")) return json(namedResponse(current));
      if (url.startsWith("/api/scryfall/printings")) return json({ ok: true, printings: [] });
      if (url.startsWith("/api/scryfall/import-art")) {
        const mode = (JSON.parse(String(init?.body)) as { mode: string }).mode;
        artModes.push(mode);
        return artOk(mode)
          ? json({ ok: true, publicUrl: `https://cdn.example/${mode}.jpg`, artist: null, source: {} })
          : new Response(JSON.stringify({ ok: false, error: "no" }), { status: 404 });
      }
      return new Response("{}", { status: 404 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.mocked(toast.message).mockClear();
});

async function importWithArt(key: Key) {
  current = key;
  const onImport = vi.fn();
  render(
    <ScryfallImportDialog signedIn open onOpenChange={() => {}} onImport={onImport} />,
  );
  fireEvent.change(screen.getByLabelText("Search Scryfall"), {
    target: { value: printings[key].name.split(" // ")[0] },
  });
  fireEvent.click(
    await screen.findByRole("option", { name: new RegExp(printings[key].name.split(" // ")[0]!) }),
  );
  await screen.findByText(/Will populate/);
  // "Also import artwork" is on by default.
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: /use as starting point/i }));
  await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
  return onImport.mock.calls[0]![0];
}

describe("ScryfallImportDialog — back-face art only when the face has an image", () => {
  it("Bonecrusher Giant (ELD #115, an adventure): front art only, no back-face toast", async () => {
    const payload = await importWithArt("eld-115");
    expect(artModes).toEqual(["art"]);
    expect(toast.message).not.toHaveBeenCalled();
    expect(payload.importedArtUrl).toBe("https://cdn.example/art.jpg");
    // The adventure's text still rides as the second face, with no art.
    expect(payload.patch.back_face.title).toBe("Stomp");
    expect(payload.patch.back_face.imported_art_url).toBeNull();
  });

  it("Fire // Ice (DMR #215, a split card): front art only; each half keeps its own artist", async () => {
    const payload = await importWithArt("dmr-215");
    expect(artModes).toEqual(["art"]);
    expect(toast.message).not.toHaveBeenCalled();
    expect(payload.patch.artist_credit).toBe("David Martin");
    expect(payload.patch.back_face.artist_credit).toBe("Franz Vohwinkel");
  });

  it("Delver of Secrets (ISD #51, a DFC): both faces' art", async () => {
    const payload = await importWithArt("isd-51");
    expect([...artModes].sort()).toEqual(["art", "art-back"]);
    expect(payload.patch.back_face.imported_art_url).toBe("https://cdn.example/art-back.jpg");
    expect(toast.message).not.toHaveBeenCalled();
  });

  it("a DFC whose back art fails still says so", async () => {
    artOk = (mode) => mode === "art";
    await importWithArt("isd-51");
    expect(toast.message).toHaveBeenCalledWith("Imported the front art", {
      description:
        "The back-face art couldn't be fetched — you can add it on the Layout step.",
    });
  });
});
