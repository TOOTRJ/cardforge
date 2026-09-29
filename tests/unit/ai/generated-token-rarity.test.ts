import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// TODO 3b.15, owner decision 2026-09-29: a NEW token saves as common — it
// prints a black set symbol, never a rarity, and the token kind hides the
// rarity chips, so the creator could never set an AI-made rare token back.
// The creator's own save already forces it; this pins the AI card step that
// saves a designed card directly (a single "card" job — the deck job shares
// runGeneratedCardStep). Supabase, the credit wrapper, the art calls and
// createCardAction are stubbed; the payload the step saves is captured.
// ---------------------------------------------------------------------------

const s = vi.hoisted(() => ({
  created: [] as Record<string, unknown>[],
  patched: [] as Record<string, unknown>[],
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
      if (name === "claim_job_step") return { data: { job: s.job, step_key: "card:0" }, error: null };
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
vi.mock("@/lib/cards/capacity", () => ({ getCardCapacity: async () => null }));
vi.mock("@/lib/ai/image-gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/image-gen")>()),
  generateImageWithFallbacks: async () => ({ ok: true, bytes: new Uint8Array([1, 2, 3]), contentType: "image/png" }),
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
vi.mock("@/lib/cards/actions", () => ({
  createCardAction: async (payload: Record<string, unknown>) => {
    s.created.push(payload);
    return { ok: true, cardId: "card-1", slug: "made" };
  },
  updateCardAction: async () => ({ ok: true }),
}));

import { runNextJobStep } from "@/lib/ai/generation-jobs";

const designed = {
  title: "Soldier",
  cost: "—",
  card_type: "token",
  supertype: "Creature",
  subtypes: ["Soldier"],
  rarity: "rare",
  color_identity: ["white"],
  rules_text: "Vigilance",
  flavor_text: null,
  power: "1",
  toughness: "1",
  loyalty: null,
  defense: null,
  art_prompt: "A soldier on a wall at dawn.",
};

async function runCardJob(card: Record<string, unknown>) {
  s.job = {
    id: "job-1",
    owner_id: "user-1",
    kind: "card",
    status: "generating",
    request: {},
    deck_id: null,
    error: null,
    plan: { card, style: null, frame_template: "m15token" },
    steps: [{ key: "card:0", label: String(card.title), status: "running" }],
  };
  const result = await runNextJobStep("job-1", "card:0");
  expect(result.ok).toBe(true);
  expect(s.patched.at(-1)?.status).toBe("done");
  return s.created.at(-1)!;
}

beforeEach(() => {
  s.created = [];
  s.patched = [];
});

describe("the AI card step saves a new token as common (TODO 3b.15)", () => {
  it("a token the designer made rare saves common", async () => {
    const saved = await runCardJob(designed);
    expect(saved).toMatchObject({ card_type: "token", supertype: "Creature", rarity: "common" });
  });

  it("any other card keeps the designer's rarity", async () => {
    const saved = await runCardJob({ ...designed, title: "Wall Warden", card_type: "creature", supertype: null, cost: "{1}{W}" });
    expect(saved).toMatchObject({ card_type: "creature", rarity: "rare" });
  });
});
