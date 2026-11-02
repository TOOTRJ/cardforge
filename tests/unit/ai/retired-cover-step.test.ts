import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// TODO DK6.3: AI deck covers are retired (a deck with no upload shows its
// default background, lib/decks/cover.ts). A deck job planned BEFORE the
// change can still hold a cover step — pending, mid-claim, or failed on an
// earlier try — and deck jobs already running finish (owner decision D6).
//
// Drives the REAL step runner over stubbed Supabase: such a step completes
// at once as "done" — no image call, no stored picture, no deck write, no
// AI-call row, no credit reserved, spent or refunded, and no spend_ref for
// patch_job_step to settle (the cover never had a ledger row: it was free,
// owner decision 2026-09-15) — so the job ends "done" and the runner stops.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const DECK = "33333333-3333-4333-8333-333333333333";

const s = vi.hoisted(() => ({
  job: null as unknown as Record<string, unknown>,
  stepKey: "cover" as string | null,
  patched: [] as Array<{ key: string; patch: Record<string, unknown> }>,
  imageCalls: 0,
  persistCalls: 0,
  aiCalls: [] as string[],
  spend: vi.fn(),
  refund: vi.fn(),
  deckUpdates: [] as unknown[],
  buildGuide: vi.fn(),
  guidesOn: false,
}));

vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => ({ id: USER }),
  getCurrentProfile: async () => ({ display_name: "Tester", username: "tester", is_admin: false }),
  createClient: async () => ({
    from: () => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: s.job, error: null }),
      };
      return chain;
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "claim_job_step") return { data: { job: s.job, step_key: s.stepKey }, error: null };
      if (name === "patch_job_step") {
        s.patched.push({ key: args.p_step_key as string, patch: args.p_patch as Record<string, unknown> });
        return { data: s.job, error: null };
      }
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    },
  }),
}));
vi.mock("@/lib/ai/image-gen", async (importOriginal) => {
  const image = async () => {
    s.imageCalls += 1;
    return { ok: true, bytes: new Uint8Array([1]), contentType: "image/png", promptIndex: 0 };
  };
  return {
    ...(await importOriginal<typeof import("@/lib/ai/image-gen")>()),
    generatePlainImage: image,
    generateImageWithFallbacks: image,
    restyleImage: image,
  };
});
vi.mock("@/lib/ai/random-art", () => ({
  persistGeneratedArt: async () => {
    s.persistCalls += 1;
    return { ok: true, publicUrl: "https://example.supabase.co/storage/v1/object/public/card-art/x.png" };
  },
}));
vi.mock("@/lib/ai/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/rate-limit")>()),
  logAiCall: async (_user: string, action: string) => {
    s.aiCalls.push(action);
  },
  spendCredits: s.spend,
  refundCredits: s.refund,
}));
vi.mock("@/lib/decks/actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/decks/actions")>()),
  updateDeckAction: async (...args: unknown[]) => {
    s.deckUpdates.push(args);
    return { ok: true };
  },
}));

vi.mock("@/lib/decks/guides", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/decks/guides")>()),
  buildAndStoreDeckGuide: s.buildGuide,
}));
vi.mock("@/lib/ai/deck-ai-pause", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/deck-ai-pause")>()),
  areDeckGuidesEnabled: () => s.guidesOn,
}));

import { runNextJobStep } from "@/lib/ai/generation-jobs";

const DECK_PLAN = {
  deck_title: "Old Deck",
  strategy: "Go wide.",
  theme: "goblins",
  style: null,
  format: "commander",
  cards: [],
  roles: [],
  quantities: [],
};
const REMIX_PLAN = { deck_title: "Old Deck", style: "ink", theme: null, entries: [], skipped: 0 };

function oldJob(kind: "deck" | "deck_remix", cover: Record<string, unknown>) {
  s.job = {
    id: "job-old",
    owner_id: USER,
    kind,
    status: "generating",
    request: {},
    deck_id: DECK,
    error: null,
    plan: kind === "deck" ? DECK_PLAN : REMIX_PLAN,
    steps: [
      { key: kind === "deck" ? "card:0" : "remix:0", label: "A card", status: "done", spend_ref: "spend:job-old:card:0:abc" },
      { key: "cover", label: "Deck cover", ...cover },
      { key: "guide", label: "How to play guide", status: "done" },
    ],
  };
}

beforeEach(() => {
  s.patched = [];
  s.imageCalls = 0;
  s.persistCalls = 0;
  s.aiCalls = [];
  s.deckUpdates = [];
  s.guidesOn = false;
  s.buildGuide.mockReset().mockResolvedValue({ ok: true, guide: {} });
  s.spend.mockReset().mockResolvedValue({ ok: true, balance: 4, charged: true });
  s.refund.mockReset().mockResolvedValue(true);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

function expectNothingSpentOrPainted() {
  expect(s.imageCalls).toBe(0);
  expect(s.persistCalls).toBe(0);
  expect(s.aiCalls).toEqual([]);
  expect(s.deckUpdates).toEqual([]);
  expect(s.spend).not.toHaveBeenCalled();
  expect(s.refund).not.toHaveBeenCalled();
}

describe("an old deck job's AI cover step (TODO DK6.3)", () => {
  it.each(["deck", "deck_remix"] as const)("a %s job's pending cover step completes as done — no image, no charge, nothing to settle", async (kind) => {
    oldJob(kind, { status: "running" });
    s.stepKey = "cover";
    const result = await runNextJobStep("job-old", "cover");
    expect(result.ok).toBe(true);
    expect(s.patched).toHaveLength(1);
    const { key, patch } = s.patched[0]!;
    expect(key).toBe("cover");
    expect(patch).toMatchObject({ key: "cover", status: "done", failure: null, error_code: null, spend_ref: null, refunded: null, refund_pending: null });
    // null, never left out: the jsonb merge must CLEAR an older error.
    expect(patch.error).toBeNull();
    expectNothingSpentOrPainted();
  });

  it("the runner asking for the NEXT step (no key) is handed the cover and finishes it the same way", async () => {
    oldJob("deck", { status: "running" });
    s.stepKey = "cover";
    expect((await runNextJobStep("job-old")).ok).toBe(true);
    expect(s.patched.map((p) => [p.key, p.patch.status])).toEqual([["cover", "done"]]);
    expectNothingSpentOrPainted();
  });

  it("a cover step that failed on an earlier try (an AI refusal) is done when it is reached again, its old failure cleared", async () => {
    oldJob("deck", { status: "running", error: "The image service refused this prompt.", failure: "art_refused", attempts: 2 });
    s.stepKey = "cover";
    await runNextJobStep("job-old", "cover");
    const { patch } = s.patched[0]!;
    expect(patch).toMatchObject({ status: "done", failure: null, error_code: null, spend_ref: null });
    // null, never left out: the jsonb merge must CLEAR an older error.
    expect(patch.error).toBeNull();
    expectNothingSpentOrPainted();
  });

  it("a cover step another request already finished is not run again", async () => {
    oldJob("deck", { status: "done" });
    s.stepKey = null;
    const result = await runNextJobStep("job-old", "cover");
    expect(result).toMatchObject({ ok: true });
    expect(s.patched).toEqual([]);
    expectNothingSpentOrPainted();
  });
});

// Deck guides are hidden (owner 2026-10-30, DECK_GUIDES_ENABLED): a deck
// job already running (D6) reaches its free guide step and writes NO guide —
// no AI call, nothing stored — and the step is done, so the job ends.
describe("a running deck job's guide step while deck guides are hidden", () => {
  function guideJob() {
    oldJob("deck", { status: "done" });
    (s.job.steps as Array<Record<string, unknown>>)[2] = { key: "guide", label: "How to play guide", status: "running" };
  }

  it("completes as done without building or storing a guide", async () => {
    guideJob();
    s.stepKey = "guide";
    expect((await runNextJobStep("job-old", "guide")).ok).toBe(true);
    expect(s.patched.map((p) => [p.key, p.patch.status])).toEqual([["guide", "done"]]);
    expect(s.buildGuide).not.toHaveBeenCalled();
    expectNothingSpentOrPainted();
  });

  it("the flag flipped back: the step builds the guide as before", async () => {
    s.guidesOn = true;
    guideJob();
    s.stepKey = "guide";
    await runNextJobStep("job-old", "guide");
    expect(s.buildGuide).toHaveBeenCalledWith(DECK, "generation");
    expect(s.patched.map((p) => [p.key, p.patch.status])).toEqual([["guide", "done"]]);
  });
});
