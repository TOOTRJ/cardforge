import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import printings from "../scryfall/fixtures/import-printings.json";

// ---------------------------------------------------------------------------
// GET /api/scryfall/named (TODO 1.12 + 1.8):
//   • an empty parameter is absent (`?id=&exact=Lightning%20Bolt` looks up
//     the exact name); two non-empty ones are a 400;
//   • a name that finds no card says why — several match (Scryfall's
//     "ambiguous" 404), none does, Scryfall refused (400) or failed (502);
//   • only a found card spends the user's quota;
//   • the card payload says whether the second face has its own image.
// The Scryfall client's network calls are mocked; its pure helpers and the
// import mapper are the real ones, run on real (trimmed) payloads.
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  check: vi.fn(),
  log: vi.fn(),
  byId: vi.fn(),
  byName: vi.fn(),
  set: vi.fn(),
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => state.user,
}));
vi.mock("@/lib/scryfall/rate-limit", () => ({
  checkScryfallRateLimit: state.check,
  logScryfallCall: state.log,
}));
vi.mock("@/lib/scryfall/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/scryfall/client")>()),
  getCardById: state.byId,
  getCardByNameResult: state.byName,
  getScryfallSet: state.set,
}));

import { GET } from "@/app/api/scryfall/named/route";
import { scryfallCardSchema, scryfallSetSchema } from "@/lib/scryfall/client";
import collectorPrintings from "../scryfall/fixtures/collector-printings.json";
import collectorSets from "../scryfall/fixtures/collector-sets.json";

type PrintingKey = keyof typeof printings;
const card = (key: PrintingKey) => scryfallCardSchema.parse(printings[key]);
type CollectorKey = keyof typeof collectorPrintings;
const collectorCard = (key: CollectorKey) => scryfallCardSchema.parse(collectorPrintings[key]);

function get(query: string) {
  return GET(new NextRequest(`https://www.pipglyph.com/api/scryfall/named?${query}`));
}

beforeEach(() => {
  state.user = { id: "user-1" };
  state.check.mockReset().mockResolvedValue({ ok: true });
  state.log.mockReset().mockResolvedValue(undefined);
  state.byId.mockReset().mockResolvedValue(null);
  state.byName.mockReset().mockResolvedValue({ ok: true, card: card("dom-168") });
  state.set.mockReset().mockImplementation(async (code: string) => {
    const raw = (collectorSets as Record<string, unknown>)[code];
    return raw ? scryfallSetSchema.parse(raw) : null;
  });
});

describe("GET /api/scryfall/named — the collector fields follow the printing (TODO 4.9a)", () => {
  it.each([
    // [fixture, set calls, set code, number, lang]
    ["dmu-107", 1, "DMU", "107/281", "en"],
    ["dmu-107-es", 1, "DMU", "107/281", "es"],
    ["tdom-1", 1, "DOM", "1/16", "en"],
    ["tfdn-24", 1, "FDN", "24", "en"],
    ["fdn-1", 0, "FDN", "1", "en"],
    ["onc-114", 0, "ONC", "114", "en"],
    ["pw23-3", 0, "PRM", "3", "ph"],
  ] as const)("%s → %i set call(s): %s · %s · %s", async (key, calls, setCode, number, lang) => {
    const printing = collectorCard(key);
    state.byId.mockResolvedValue(printing);
    const body = await (await get(`id=${printing.id}`)).json();
    expect(body.ok).toBe(true);
    expect(body.patch.collector).toEqual({ set_code: setCode, collector_number: number, lang });
    expect(state.set).toHaveBeenCalledTimes(calls);
    if (calls) expect(state.set).toHaveBeenCalledWith(printing.set);
    // The set lookup is cached upstream and counts against no user quota:
    // the card lookup is logged once, as before.
    expect(state.log).toHaveBeenCalledTimes(1);
  });

  it("fills no collector fields when Scryfall has no answer for the set — never a guessed size", async () => {
    state.set.mockResolvedValue(null);
    const printing = collectorCard("dmu-107");
    state.byId.mockResolvedValue(printing);
    const body = await (await get(`id=${printing.id}`)).json();
    expect(body.ok).toBe(true);
    expect(body.patch.collector).toBeUndefined();
    // The rest of the import is untouched.
    expect(body.patch.title).toBe("Sheoldred, the Apocalypse");
    expect(body.patch.source_scryfall_id).toBe(printing.id);
  });
});

describe("GET /api/scryfall/named — which parameter is read", () => {
  it("treats an empty parameter as absent", async () => {
    const res = await get("id=&exact=Lightning%20Bolt");
    expect(res.status).toBe(200);
    expect(state.byId).not.toHaveBeenCalled();
    expect(state.byName).toHaveBeenCalledWith({ exact: "Lightning Bolt" });
  });

  it("refuses two non-empty parameters before calling Scryfall", async () => {
    const res = await get("id=11bf83bb-c95b-4b4f-9a56-ce7a1816307a&exact=Lightning%20Bolt");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Provide only one of id, exact, or fuzzy.");
    expect(state.check).not.toHaveBeenCalled();
    expect(state.byId).not.toHaveBeenCalled();
    expect(state.byName).not.toHaveBeenCalled();
  });

  it("refuses no parameter, or only empty ones", async () => {
    for (const query of ["", "id=&exact=&fuzzy=%20"]) {
      const res = await get(query);
      expect(res.status, query).toBe(400);
      expect((await res.json()).error).toBe("Provide id, exact, or fuzzy.");
    }
    expect(state.byName).not.toHaveBeenCalled();
  });

  it("looks up by id, and a fuzzy name as fuzzy", async () => {
    state.byId.mockResolvedValue(card("isd-51"));
    expect((await get("id=11bf83bb-c95b-4b4f-9a56-ce7a1816307a")).status).toBe(200);
    expect(state.byId).toHaveBeenCalledWith("11bf83bb-c95b-4b4f-9a56-ce7a1816307a");
    expect((await get("fuzzy=llanowar")).status).toBe(200);
    expect(state.byName).toHaveBeenCalledWith({ fuzzy: "llanowar" });
  });
});

describe("GET /api/scryfall/named — no card, and why", () => {
  it.each([
    ["ambiguous", "fuzzy=bolt", 404, "Several cards match “bolt” — type more of the name."],
    ["not_found", "exact=Zzyzx", 404, "No card named “Zzyzx”."],
    ["bad_request", "exact=Zzyzx", 400, "Scryfall couldn't look up “Zzyzx”."],
    ["upstream", "exact=Zzyzx", 502, "Scryfall didn't answer — try again in a moment."],
  ] as const)("%s → %i", async (kind, query, status, error) => {
    state.byName.mockResolvedValue({ ok: false, kind });
    const res = await get(query);
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ ok: false, error });
    // Only a found card spends the user's Scryfall quota.
    expect(state.log).not.toHaveBeenCalled();
  });

  it("an unknown id is a 404 and costs nothing", async () => {
    const res = await get("id=00000000-0000-4000-8000-000000000000");
    expect(res.status).toBe(404);
    expect(state.log).not.toHaveBeenCalled();
  });

  it("logs a found card once", async () => {
    await get("exact=Llanowar%20Elves");
    expect(state.log).toHaveBeenCalledWith("user-1", "named");
    expect(state.log).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/scryfall/named — has_back_image (TODO 1.8)", () => {
  it.each([
    ["isd-51", true],
    ["eld-115", false],
    ["dmr-215", false],
    ["dom-168", false],
  ] as const)("%s → %s", async (key, expected) => {
    state.byId.mockResolvedValue(card(key));
    const body = await (await get(`id=${card(key).id}`)).json();
    expect(body.ok).toBe(true);
    expect(body.card.has_back_image).toBe(expected);
    // The patch still carries the second face's text either way.
    expect(Boolean(body.patch.back_face)).toBe(key !== "dom-168");
  });
});
