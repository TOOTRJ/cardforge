import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// TODO 4.6.0 (4.6 review 2026-09-29) — the AI deck remix of the user's OWN
// card and the anatomy switches. The creator's remix keeps a parent's
// explicit crown / two-colour switch (remixValuesFrom); the deck remix did
// not (its own-card mechanics carried no anatomy, so createCardAction
// stamped the new-card default: a parent its owner switched OFF came back
// ON). Same harness as deck-remix-step-frame.test.ts: Supabase, credits, AI
// and the card read are stubbed; createCardAction's payload is recorded.
// ---------------------------------------------------------------------------

const s = vi.hoisted(() => ({
  verified: [] as string[],
  printing: null as unknown,
  source: null as unknown,
  created: [] as Record<string, unknown>[],
  patched: [] as Record<string, unknown>[],
  identity: vi.fn(),
  image: vi.fn(),
  job: null as unknown as Record<string, unknown>,
}));

vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => ({ id: "user-1" }),
  getCurrentProfile: async () => ({ display_name: "Tester", username: "tester" }),
  createClient: async () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        update: () => chain,
        maybeSingle: async () =>
          table === "ai_generation_jobs"
            ? { data: s.job, error: null }
            : { data: { id: "33333333-3333-4333-8333-333333333333" }, error: null },
      };
      return chain;
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "claim_job_step") {
        return { data: { job: s.job, step_key: "remix:0" }, error: null };
      }
      if (name === "patch_job_step") {
        s.patched.push(args.p_patch as Record<string, unknown>);
        return { data: s.job, error: null };
      }
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    },
  }),
}));
vi.mock("@/lib/ai/credited-step", () => ({
  withCreditedStep: async (
    _user: string,
    _job: string,
    _amount: number,
    _reason: string,
    _step: unknown,
    body: () => Promise<unknown>,
  ) => body(),
}));
vi.mock("@/lib/cards/frame-reviews", () => ({
  getVerifiedFrameKeys: async () => s.verified,
}));
vi.mock("@/lib/scryfall/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/scryfall/client")>()),
  getCardById: async () => s.printing,
}));
vi.mock("@/lib/ai/remix", () => ({ generateRemixIdentity: s.identity }));
vi.mock("@/lib/ai/image-gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/image-gen")>()),
  generatePlainImage: s.image,
}));
vi.mock("@/lib/ai/random-art", () => ({
  persistGeneratedArt: async () => ({
    ok: true,
    publicUrl: "https://example.supabase.co/storage/v1/object/public/card-art/x.png",
  }),
}));
vi.mock("@/lib/ai/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/rate-limit")>()),
  logAiCall: async () => undefined,
}));
vi.mock("@/lib/cards/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cards/queries")>()),
  getCardById: async () => s.source,
}));
vi.mock("@/lib/cards/actions", () => ({
  createCardAction: async (payload: Record<string, unknown>) => {
    s.created.push(payload);
    return { ok: true, cardId: "card-1", slug: "remixed" };
  },
  updateCardAction: async () => ({ ok: true }),
}));

import { runNextJobStep } from "@/lib/ai/generation-jobs";

function source(frameStyle: Record<string, unknown>) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Kesh, Emberforge Warden",
    cost: "{2}{R}{R}",
    card_type: "creature",
    supertype: "Legendary",
    subtypes: ["Dwarf"],
    rarity: "rare",
    color_identity: ["red"],
    rules_text: "Haste",
    flavor_text: null,
    power: "3",
    toughness: "4",
    loyalty: null,
    defense: null,
    art_url: null,
    frame_style: frameStyle,
  };
}

async function remixOwn(frameStyle: Record<string, unknown>) {
  s.source = source(frameStyle);
  s.job = {
    id: "job-1",
    owner_id: "user-1",
    kind: "deck_remix",
    status: "generating",
    request: {},
    deck_id: "deck-1",
    error: null,
    plan: {
      deck_title: "Deck",
      style: "watercolour",
      theme: null,
      skipped: 0,
      entries: [{ board: "main", quantity: 1, name: "Kesh, Emberforge Warden", card_id: "11111111-1111-4111-8111-111111111111", scryfall_id: null }],
    },
    steps: [{ key: "remix:0", label: "Kesh", status: "running" }],
  };
  const result = await runNextJobStep("job-1", "remix:0");
  expect(result.ok).toBe(true);
  expect(s.patched.at(-1)?.status).toBe("done");
  return s.created.at(-1)!;
}

beforeEach(() => {
  s.created = [];
  s.patched = [];
  s.verified = [];
  s.identity.mockReset().mockResolvedValue({
    title: "Remixed Name",
    flavor_text: "New flavour.",
    art_instruction: "A painted scene.",
  });
  s.image.mockReset().mockResolvedValue({ ok: true, bytes: new Uint8Array([1, 2, 3]), contentType: "image/png" });
});

describe("executeDeckRemixStep — an own card's anatomy switches", () => {
  it("a parent its owner switched off stays off (both switches)", async () => {
    const card = await remixOwn({ template: "m15", crown: false, twoColor: false });
    expect(card.frame_style).toEqual({ crown: false, twoColor: false });
  });

  it("a parent switched on stays on", async () => {
    const card = await remixOwn({ template: "m15", crown: true });
    expect(card.frame_style).toEqual({ crown: true });
  });

  it("a parent that never set a switch sends none: createCardAction stamps the new-card default", async () => {
    const card = await remixOwn({ template: "m15", finish: "foil" });
    expect(card.frame_style).toBeUndefined();
  });
});
