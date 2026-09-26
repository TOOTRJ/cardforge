// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import printings from "../scryfall/fixtures/treatment-printings.json";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import { mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";

// ---------------------------------------------------------------------------
// TODO 1.16 stopgap, dialog half: picking a borderless (or showcase / full-
// art / textless) printing says, before "Use as starting point", that the
// import lands on a plain frame — and the treatment rides on the patch the
// form receives (which toasts the landed frame). A plain printing says
// nothing. The /api/scryfall/* routes are stubbed with the real mapper's
// output for real (trimmed) Scryfall payloads.
// ---------------------------------------------------------------------------

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), message: vi.fn(), info: vi.fn() },
}));

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
    },
    // Through JSON, exactly like the route's NextResponse.json.
    patch: JSON.parse(JSON.stringify(mapScryfallToFormPatch(card))),
  };
}

let current: Key = "dmu-435";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), { status: 200 });
      if (url.startsWith("/api/scryfall/search")) {
        const card = printings[current];
        return json({
          ok: true,
          results: [
            {
              id: card.id,
              name: card.name,
              set: card.set,
              set_name: card.set_name,
              type_line: card.type_line,
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
      if (url.startsWith("/api/scryfall/printings")) {
        return json({ ok: true, printings: [] });
      }
      return new Response("{}", { status: 404 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function pickPrinting(key: Key, onImport = vi.fn()) {
  current = key;
  render(
    <ScryfallImportDialog
      signedIn
      open
      onOpenChange={() => {}}
      onImport={onImport}
    />,
  );
  fireEvent.change(screen.getByLabelText("Search Scryfall"), {
    target: { value: printings[key].name },
  });
  const option = await screen.findByRole("option", {
    name: new RegExp(printings[key].name.split(",")[0]),
  });
  fireEvent.click(option);
  await screen.findByText(/Will populate/);
  return onImport;
}

describe("ScryfallImportDialog — printing treatment heads-up", () => {
  it("borderless Sheoldred (DMU #435): warns before import and hands the treatment to the form", async () => {
    const onImport = await pickPrinting("dmu-435");
    expect(
      screen.getByText(
        "This printing is borderless, which PipGlyph doesn't offer yet — the import uses a bordered frame instead.",
      ),
    ).toBeTruthy();

    // Skip the art fetch; commit.
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /use as starting point/i }));
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    const payload = onImport.mock.calls[0]![0];
    expect(payload.patch.printing_treatment).toBe("borderless");
    // The stopgap never changes the frame the import picks.
    expect(payload.patch.frame_template).toBe("m15");
  });

  it("full-art basic (ONE #262): names full art", async () => {
    await pickPrinting("one-262");
    expect(screen.getByText(/This printing is full art, which PipGlyph doesn't offer yet/)).toBeTruthy();
  });

  it("plain M15 printing (DMU #107): no heads-up", async () => {
    await pickPrinting("dmu-107");
    expect(screen.queryByText(/which PipGlyph doesn't offer yet/)).toBeNull();
  });
});
