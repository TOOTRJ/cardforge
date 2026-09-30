import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chainClient, payloadOf } from "@/tests/stubs/supabase-chain";
import { getSiteBaseUrl } from "@/lib/site-url";

// ---------------------------------------------------------------------------
// The oEmbed half of the owner decision of 2026-09-29 (TODO 6.23): an emblem
// is "<walker> Emblem" wherever its page is named — here the title a forum or
// a blog shows over the embedded card — as Scryfall names it. The route reads
// the card's type for that (cardPageName), so the stub answers only the
// columns the route selects. Any other card keeps its title.
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({ client: null as unknown }));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/public", () => ({ createPublicClient: () => state.client }));

import { GET } from "@/app/api/oembed/route";

const OWNER = "11111111-1111-4111-8111-111111111111";
const CARD = "22222222-2222-4222-8222-222222222222";

type Row = Record<string, unknown>;

function serve(card: Row) {
  state.client = chainClient((table, calls) => {
    if (table === "profiles") return { data: { id: OWNER, username: "tester", display_name: "Tester" } };
    const columns = String(payloadOf(calls, "select") ?? "")
      .split(",")
      .map((c) => c.trim());
    return { data: Object.fromEntries(columns.filter((c) => c in card).map((c) => [c, card[c]])) };
  }).client;
}

async function oembedTitle(slug: string): Promise<string> {
  const page = `${getSiteBaseUrl()}/card/tester/${slug}`;
  const res = await GET(new NextRequest(`${getSiteBaseUrl()}/api/oembed?url=${encodeURIComponent(page)}`));
  expect(res.status).toBe(200);
  return ((await res.json()) as { title: string }).title;
}

const EMBLEM: Row = {
  id: CARD,
  title: "Kaito, Cunning Infiltrator",
  card_type: "emblem",
  updated_at: "2026-09-29T00:00:00Z",
  rendered_at: null,
  visibility: "public",
  frame_style: { template: "emblem" },
};

beforeEach(() => {
  state.client = null;
});

describe("oEmbed title (owner decision 2026-09-29)", () => {
  it("an emblem is '<walker> Emblem'", async () => {
    serve(EMBLEM);
    expect(await oembedTitle("kaito-cunning-infiltrator-emblem")).toBe("Kaito, Cunning Infiltrator Emblem");
  });

  it("any other card keeps its title", async () => {
    serve({ ...EMBLEM, title: "Soldier", card_type: "token", frame_style: { template: "m15token" } });
    expect(await oembedTitle("soldier")).toBe("Soldier");
  });
});
