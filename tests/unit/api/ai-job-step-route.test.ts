import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// POST /api/ai/jobs/[id]/step while AI deck building is paused (owner
// 2026-10-28, TODO DK1 — D6, lib/ai/deck-ai-pause.ts). Re-running a FAILED
// step of a deck build or deck remix reserves a NEW credit (the failed
// attempt was refunded) and calls the AI — claim_job_step accepts a failed
// step by key, even on a finished job — so the route refuses it with 403
// DECK_AI_PAUSED before the rate limit, the claim or any charge. A running
// job's pending and running steps keep stepping (work already paid for
// finishes), and a card job's retry is create-card AI (D5).
// ---------------------------------------------------------------------------

type Step = { key: string; status: string };

const s = vi.hoisted(() => ({
  paused: true,
  job: null as { kind: string; steps: Step[] } | null,
  reads: 0,
  rate: vi.fn(),
  run: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("@/lib/ai/deck-ai-pause", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/deck-ai-pause")>()),
  isDeckAiPaused: () => s.paused,
}));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => ({ id: "user-1" }),
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            s.reads += 1;
            return { data: s.job };
          },
        }),
      }),
    }),
  }),
}));
vi.mock("@/lib/ai/rate-limit", () => ({
  checkAiRateLimit: s.rate,
  getFreshCreditBalance: async () => 7,
}));
vi.mock("@/lib/ai/generation-jobs", () => ({ runNextJobStep: s.run }));
vi.mock("@/lib/ai/job-notify", () => ({ notifyDeckJobFinished: s.notify }));

import { POST } from "@/app/api/ai/jobs/[id]/step/route";

const JOB_ID = "22222222-2222-4222-8222-222222222222";

const step = async (body: Record<string, unknown> = {}) => {
  const res = await POST(
    new Request(`http://x/api/ai/jobs/${JOB_ID}/step`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: JOB_ID }) },
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};

const deckJob = (kind: "deck" | "deck_remix", steps: Step[]) => {
  s.job = { kind, steps };
};

beforeEach(() => {
  s.paused = true;
  s.job = null;
  s.reads = 0;
  s.rate.mockReset().mockResolvedValue({ ok: true });
  s.run.mockReset().mockImplementation(async () => ({ ok: true, job: { id: JOB_ID, steps: s.job?.steps ?? [], plan: { secret: true } } }));
  s.notify.mockReset().mockResolvedValue(undefined);
});

describe("POST /api/ai/jobs/[id]/step — while AI deck building is paused", () => {
  it.each(["deck", "deck_remix"] as const)(
    "refuses a %s job's FAILED step with 403 DECK_AI_PAUSED, before the rate limit, the claim or any charge",
    async (kind) => {
      deckJob(kind, [
        { key: "card:0", status: "done" },
        { key: "card:1", status: "failed" },
        { key: "cover", status: "done" },
      ]);
      const { status, json } = await step({ step: "card:1" });
      expect(status).toBe(403);
      expect(json).toMatchObject({ ok: false, code: "DECK_AI_PAUSED" });
      expect(s.rate).not.toHaveBeenCalled();
      expect(s.run).not.toHaveBeenCalled();
    },
  );

  it("a failed guide or cover step is refused too (no new guide, D4)", async () => {
    deckJob("deck", [
      { key: "card:0", status: "done" },
      { key: "guide", status: "failed" },
    ]);
    expect((await step({ step: "guide" })).status).toBe(403);
    expect(s.run).not.toHaveBeenCalled();
  });

  it("a running deck job's pending and running steps keep stepping (D6)", async () => {
    deckJob("deck", [
      { key: "card:0", status: "done" },
      { key: "card:1", status: "failed" },
      { key: "card:2", status: "running" },
      { key: "card:3", status: "pending" },
    ]);
    for (const key of ["card:2", "card:3"]) {
      const { status, json } = await step({ step: key });
      expect(status).toBe(200);
      expect(json.ok).toBe(true);
      // The plan never leaves the server.
      expect(json.job).not.toHaveProperty("plan");
    }
    expect(s.run.mock.calls).toEqual([
      [JOB_ID, "card:2"],
      [JOB_ID, "card:3"],
    ]);
    expect(s.rate).toHaveBeenCalledTimes(2);
  });

  it("an unkeyed request (the next pending step) is never refused and reads nothing extra", async () => {
    deckJob("deck", [{ key: "card:0", status: "failed" }]);
    expect((await step()).status).toBe(200);
    expect(s.reads).toBe(0);
    expect(s.run).toHaveBeenCalledWith(JOB_ID, undefined);
  });

  it("a card job's failed step is create-card AI and still retries (D5)", async () => {
    s.job = { kind: "card", steps: [{ key: "card:0", status: "failed" }] };
    expect((await step({ step: "card:0" })).status).toBe(200);
    expect(s.run).toHaveBeenCalledWith(JOB_ID, "card:0");
  });

  it("a job the caller can't read is left to the step runner's own answer", async () => {
    s.job = null;
    s.run.mockResolvedValueOnce({ ok: false, error: "Job not found." });
    const { status, json } = await step({ step: "card:1" });
    expect(status).toBe(502);
    expect(json.error).toBe("Job not found.");
  });
});

describe("POST /api/ai/jobs/[id]/step — with the pause lifted", () => {
  it("a deck job's failed step re-runs as before, and nothing extra is read", async () => {
    s.paused = false;
    deckJob("deck", [{ key: "card:1", status: "failed" }]);
    expect((await step({ step: "card:1" })).status).toBe(200);
    expect(s.run).toHaveBeenCalledWith(JOB_ID, "card:1");
    expect(s.reads).toBe(0);
  });
});
