import { vi } from "vitest";
import signaturePrintings from "../scryfall/fixtures/signature-printings.json";
import treatmentPrintings from "../scryfall/fixtures/treatment-printings.json";
import { scryfallCardSchema, type ScryfallCard } from "@/lib/scryfall/client";
import {
  mapScryfallToFormPatch,
  verifiedFrameMatchFromScryfall,
} from "@/lib/scryfall/import-mapper";
import { trimPrinting } from "@/lib/scryfall/printing-summary";

// ---------------------------------------------------------------------------
// The import dialog's /api/scryfall/* routes, stubbed with what the real
// routes answer for real (trimmed) Scryfall printings: /named runs the real
// mapper and finalizes the match against `serverVerified`, /printings trims
// with the route's own trimPrinting. Shared by the dialog's component tests.
// ---------------------------------------------------------------------------

export const FIXTURES = { ...signaturePrintings, ...treatmentPrintings } as Record<
  string,
  Record<string, unknown>
>;

export type FixtureKey = string;

export function card(key: FixtureKey): ScryfallCard {
  const raw = FIXTURES[key];
  if (!raw) throw new Error(`no fixture ${key}`);
  return scryfallCardSchema.parse(raw);
}

export function namedBody(key: FixtureKey, serverVerified: ReadonlySet<string>) {
  const c = card(key);
  const patch = mapScryfallToFormPatch(c);
  patch.frame_match = verifiedFrameMatchFromScryfall(c, serverVerified, patch.frame_match);
  return {
    ok: true,
    card: {
      id: c.id,
      name: c.name,
      oracle_id: c.oracle_id ?? null,
      set: c.set ?? null,
      set_name: c.set_name ?? null,
      print_url: null,
      thumb_url: null,
      scryfall_uri: null,
      image_status: null,
    },
    // Through JSON, exactly like the route's NextResponse.json.
    patch: JSON.parse(JSON.stringify(patch)),
  };
}

export function searchResult(key: FixtureKey) {
  const c = card(key);
  return {
    id: c.id,
    name: c.name,
    set: c.set ?? null,
    set_name: c.set_name ?? null,
    type_line: c.type_line ?? null,
    mana_cost: null,
    rarity: c.rarity ?? null,
    artist: null,
    thumb_url: null,
    print_url: null,
    oracle_text: null,
    image_status: null,
  };
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

export type RouteStub = {
  /** The fixture the search answers with. */
  search: FixtureKey[];
  /** /printings pages per view: view → pages (each a list of fixture keys). */
  printings: Record<string, FixtureKey[][]>;
  serverVerified: ReadonlySet<string>;
  /** Override one route (return undefined to fall through). */
  override?: (url: string, init?: RequestInit) => Promise<Response> | Response | undefined;
};

/** Stub fetch with the four routes the dialog calls; returns the mock. */
export function stubScryfallRoutes(stub: RouteStub) {
  const byId = new Map(Object.keys(FIXTURES).map((key) => [card(key).id, key]));
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const overridden = await stub.override?.(url, init);
    if (overridden) return overridden;
    if (url.startsWith("/api/scryfall/search")) {
      return json({ ok: true, results: stub.search.map(searchResult) });
    }
    if (url.startsWith("/api/scryfall/named")) {
      const id = new URL(url, "http://x").searchParams.get("id") ?? "";
      const key = byId.get(id);
      return key ? json(namedBody(key, stub.serverVerified)) : json({ ok: false, error: "Card not found." }, 404);
    }
    if (url.startsWith("/api/scryfall/printings")) {
      const params = new URL(url, "http://x").searchParams;
      const view = params.get("view") ?? "representative";
      const page = Number(params.get("page") ?? "1");
      const pages = stub.printings[view] ?? [];
      const keys = pages[page - 1] ?? [];
      return json({
        ok: true,
        printings: keys.map((key) => trimPrinting(card(key), stub.serverVerified)),
        has_more: page < pages.length,
        total_cards: pages.flat().length,
      });
    }
    if (url.startsWith("/api/scryfall/import-art")) {
      return json({ ok: false, error: "no art in tests" });
    }
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

export const EVERY_COLOUR = ["w", "u", "b", "r", "g", "c", "m"];
export const verifiedIn = (...templates: string[]) =>
  templates.flatMap((t) => EVERY_COLOUR.map((k) => `${t}/${k}`));
