import { beforeEach, describe, expect, it, vi } from "vitest";
import { fitArtToWindow, isArtFitted } from "@/lib/cards/art-fit";

// ---------------------------------------------------------------------------
// TODO 3b.18: an AI picture lands on the automatic fit of the frame the plan
// picked — the one rule (lib/cards/art-fit.ts), not three numbers of the
// job's own. No picture is generated: the image call, the storage write and
// the card actions are stubs (the harness of generated-token-rarity.test.ts);
// what the step writes with the art is captured.
// ---------------------------------------------------------------------------

const s = vi.hoisted(() => ({
  created: [] as Record<string, unknown>[],
  updated: [] as Record<string, unknown>[],
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
  updateCardAction: async (_id: string, payload: Record<string, unknown>) => {
    s.updated.push(payload);
    return { ok: true };
  },
}));

import { runNextJobStep } from "@/lib/ai/generation-jobs";

const designed = {
  title: "The Long Night",
  cost: "{2}{W}",
  card_type: "enchantment",
  supertype: null,
  subtypes: ["Saga"],
  rarity: "rare",
  color_identity: ["white"],
  rules_text: "I — Draw a card.",
  flavor_text: null,
  power: null,
  toughness: null,
  loyalty: null,
  defense: null,
  art_prompt: "A soldier on a wall at dawn.",
};

async function runCardJob(card: Record<string, unknown>, frame: string) {
  s.job = {
    id: "job-1",
    owner_id: "user-1",
    kind: "card",
    status: "generating",
    request: {},
    deck_id: null,
    error: null,
    plan: { card, style: null, frame_template: frame },
    steps: [{ key: "card:0", label: String(card.title), status: "running" }],
  };
  const result = await runNextJobStep("job-1", "card:0");
  expect(result.ok).toBe(true);
  expect(s.patched.at(-1)?.status).toBe("done");
  return { created: s.created.at(-1)!, art: s.updated.at(-1)! };
}

beforeEach(() => {
  s.created = [];
  s.updated = [];
  s.patched = [];
});

describe("an AI picture lands on the automatic fit", () => {
  it.each(["saga", "m15", "m15borderless"])("on %s: the art is attached at the fit — filled, centred, untouched", async (frame) => {
    const { art } = await runCardJob(designed, frame);
    expect(art.art_url).toBe("https://example.supabase.co/storage/v1/object/public/card-art/x.png");
    expect(art.art_position).toEqual(fitArtToWindow());
    expect(isArtFitted(art.art_position as never)).toBe(true);
  });
});
