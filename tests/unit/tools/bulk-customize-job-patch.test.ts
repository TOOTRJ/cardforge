import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobStep } from "@/lib/ai/generation-jobs";

// ---------------------------------------------------------------------------
// A Bulk Customize step's outcome reaches the job row whole: patchJobStep
// writes its `note` (a card saved but not linked, saved without its art) and
// a waiting step's `retry_after_seconds` — keys it writes ONLY for a step
// that names them, so every other job kind's patch is unchanged (the card
// job below names neither).
// ---------------------------------------------------------------------------

const s = vi.hoisted(() => ({
  patched: [] as Record<string, unknown>[],
  job: null as unknown as Record<string, unknown>,
  stepKey: "bulk:0",
  result: null as unknown as JobStep,
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
      if (name === "claim_job_step") return { data: { job: s.job, step_key: s.stepKey }, error: null };
      if (name === "patch_job_step") {
        s.patched.push(args.p_patch as Record<string, unknown>);
        return { data: s.job, error: null };
      }
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    },
  }),
}));
vi.mock("@/lib/tools/bulk-customize/step", () => ({
  runBulkCustomizeStep: async () => s.result,
}));

import { runNextJobStep } from "@/lib/ai/generation-jobs";

function bulkJob(): Record<string, unknown> {
  return {
    id: "job-1",
    owner_id: "user-1",
    kind: "bulk_customize",
    status: "generating",
    request: {},
    deck_id: null,
    error: null,
    plan: { choices: {}, entries: [] },
    steps: [{ key: "bulk:0", label: "Llanowar Elves", status: "running" }],
  };
}

beforeEach(() => {
  s.patched = [];
  s.stepKey = "bulk:0";
  s.job = bulkJob();
});

describe("the bulk step's patch", () => {
  it("writes a done card's note", async () => {
    s.result = {
      key: "bulk:0",
      label: "Llanowar Elves",
      status: "done",
      card_id: "card-1",
      error_code: null,
      note: "Saved, but not linked to its deck entry — link it from the deck page.",
      retry_after_seconds: null,
    };
    await runNextJobStep("job-1", "bulk:0");
    const patch = s.patched.at(-1)!;
    expect(patch.status).toBe("done");
    expect(patch.note).toMatch(/not linked/);
    expect(patch.retry_after_seconds).toBeNull();
    expect(patch.error_code).toBeNull();
  });

  it("writes a waiting step's retry time", async () => {
    s.result = {
      key: "bulk:0",
      label: "Llanowar Elves",
      status: "pending",
      error_code: "RATE_LIMITED",
      note: null,
      retry_after_seconds: 37,
    };
    await runNextJobStep("job-1", "bulk:0");
    const patch = s.patched.at(-1)!;
    expect(patch.status).toBe("pending");
    expect(patch.error_code).toBe("RATE_LIMITED");
    expect(patch.retry_after_seconds).toBe(37);
  });

  it("a step that names neither key writes neither", async () => {
    s.result = { key: "bulk:0", label: "Llanowar Elves", status: "failed", error: "Nope." };
    await runNextJobStep("job-1", "bulk:0");
    const patch = s.patched.at(-1)!;
    expect("note" in patch).toBe(false);
    expect("retry_after_seconds" in patch).toBe(false);
  });
});
