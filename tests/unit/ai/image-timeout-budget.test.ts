import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// One picture's wait (fix/ai-image-timeout, 2026-10-28). Production: in two
// windows FLUX.2 [flex] took 93–168 s to answer through the gateway, and the
// gateway answered EVERY request we had aborted at 70 s with a 200 and an
// image (billed). The old ladder gave each prompt 70 s and read a timeout as
// a quiet refusal: it threw away a picture on its way, paid for a reworded
// one that was just as slow, and failed every generation in the window.
//
// Now: the first prompt gets the WHOLE budget, a timeout stops (no second
// paid render), and only a refusal the provider states moves to the next,
// safer prompt.
//
// The gateway is MOCKED (`ai`'s experimental_generateImage): no picture is
// generated and no key is read.
//
// These pin the LADDER with no backup model (AI_IMAGE_FALLBACK_MODEL set to
// the default: imageModels() then has none). The backup model's hedge —
// started at 60 s or on the default's failure, once per picture — is
// image-backup-model.test.ts.
// ---------------------------------------------------------------------------

type Answer = { kind: "ok" } | { kind: "throw"; message: string };

const s = vi.hoisted(() => ({
  calls: [] as { prompt: string }[],
  answers: [] as Answer[],
  timeouts: [] as number[],
}));

vi.mock("@/lib/ai/provider", () => ({ isGatewayConfigured: () => true }));
vi.mock("ai", () => ({
  experimental_generateImage: async (args: { prompt: string }) => {
    s.calls.push({ prompt: args.prompt });
    const answer = s.answers.shift() ?? { kind: "ok" };
    if (answer.kind === "throw") throw new Error(answer.message);
    return { image: { uint8Array: new Uint8Array([1]), mediaType: "image/png" }, warnings: [] };
  },
  generateText: async () => ({ files: [] }),
}));

import {
  CARD_STEP_IMAGE_BUDGET_MS,
  IMAGE_BUDGET_MS,
  generateImageWithFallbacks,
  withFullyClothedLine,
} from "@/lib/ai/image-gen";
import { AI_FAILURE_COPY, aiFailureMessage } from "@/lib/ai/failure";
import { artPromptLadder } from "@/lib/ai/art-prompt-safety";

// What production logged for every aborted rung on 2026-10-28.
const GATEWAY_TIMEOUT =
  "Invalid error response format: Gateway request failed: The operation was aborted due to timeout";
const MODERATED = "Request Moderated: the prompt was flagged by the content filter";

let timeoutSpy: ReturnType<typeof vi.spyOn>;

const savedFallback = process.env.AI_IMAGE_FALLBACK_MODEL;

beforeEach(() => {
  process.env.AI_IMAGE_FALLBACK_MODEL = "bfl/flux-2-flex";
  s.calls = [];
  s.answers = [];
  s.timeouts = [];
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const real = AbortSignal.timeout.bind(AbortSignal);
  timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
    s.timeouts.push(ms);
    return real(ms);
  });
});

afterEach(() => {
  if (savedFallback === undefined) delete process.env.AI_IMAGE_FALLBACK_MODEL;
  else process.env.AI_IMAGE_FALLBACK_MODEL = savedFallback;
  timeoutSpy.mockRestore();
  vi.restoreAllMocks();
});

const LADDER = artPromptLadder(1, "A werewolf hunter in a foggy village.", {
  title: "Vigil of the Hollow Moon",
  typeLine: "Creature — Human Hunter",
  colors: ["black"],
});

describe("one picture's wait", () => {
  it("the budget fits the step route's 180 s with room for the work around it", () => {
    expect(IMAGE_BUDGET_MS).toBe(150_000);
    expect(CARD_STEP_IMAGE_BUDGET_MS).toBeLessThan(IMAGE_BUDGET_MS);
    // The slowest render production answered in the 02:10 window but one
    // (93–113 s; one 168 s) now arrives inside it.
    expect(IMAGE_BUDGET_MS).toBeGreaterThan(113_000);
  });

  it("the first prompt is given the WHOLE budget, never 70 s", async () => {
    const result = await generateImageWithFallbacks(LADDER, "square");
    expect(result.ok).toBe(true);
    expect(s.calls).toHaveLength(1);
    expect(s.timeouts).toHaveLength(1);
    // A few ms may pass before the call; never the old 70 s cap.
    expect(s.timeouts[0]).toBeGreaterThan(IMAGE_BUDGET_MS - 1_000);
    expect(s.timeouts[0]).toBeLessThanOrEqual(IMAGE_BUDGET_MS);
  });

  it("a step's own budget is the first prompt's wait", async () => {
    await generateImageWithFallbacks(LADDER, "square", { budgetMs: CARD_STEP_IMAGE_BUDGET_MS });
    expect(s.timeouts[0]).toBeGreaterThan(CARD_STEP_IMAGE_BUDGET_MS - 1_000);
    expect(s.timeouts[0]).toBeLessThanOrEqual(CARD_STEP_IMAGE_BUDGET_MS);
  });

  it("a timeout stops: no second, paid render of a reworded prompt", async () => {
    s.answers = [{ kind: "throw", message: GATEWAY_TIMEOUT }];
    const result = await generateImageWithFallbacks(LADDER, "square");
    expect(s.calls).toHaveLength(1);
    expect(result).toMatchObject({ ok: false, failure: "art_timeout", safetyBlocked: false });
  });

  it("a refusal the provider states still walks to the next, safer prompt", async () => {
    s.answers = [{ kind: "throw", message: MODERATED }, { kind: "ok" }];
    const result = await generateImageWithFallbacks(LADDER, "square");
    expect(s.calls).toHaveLength(2);
    expect(s.calls[1].prompt).toBe(withFullyClothedLine(LADDER[1], 4000));
    expect(result).toMatchObject({ ok: true, promptIndex: 1 });
  });

  it("refused on every prompt: art_blocked, every rung tried", async () => {
    s.answers = LADDER.map(() => ({ kind: "throw", message: MODERATED }) as Answer);
    const result = await generateImageWithFallbacks(LADDER, "square");
    expect(s.calls).toHaveLength(LADDER.length);
    expect(result).toMatchObject({ ok: false, failure: "art_blocked", safetyBlocked: true });
  });

  it("a refusal then a timeout ends as the timeout (the last thing that happened)", async () => {
    s.answers = [
      { kind: "throw", message: MODERATED },
      { kind: "throw", message: GATEWAY_TIMEOUT },
    ];
    const result = await generateImageWithFallbacks(LADDER, "square");
    expect(s.calls).toHaveLength(2);
    expect(result).toMatchObject({ ok: false, failure: "art_timeout", safetyBlocked: false });
  });

  it("the log says how long the call waited", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    s.answers = [{ kind: "throw", message: GATEWAY_TIMEOUT }];
    await generateImageWithFallbacks(LADDER, "square");
    expect(warn.mock.calls.flat().join(" ")).toMatch(/\[ai:image\].*art_timeout.*\(after \d+ s\)/);
  });
});

describe("what a timed-out picture tells its maker", () => {
  it("names the slow image service, not a reworded prompt, and the refund", () => {
    expect(AI_FAILURE_COPY.art_timeout).toContain("running slowly");
    expect(AI_FAILURE_COPY.art_timeout).toContain("took too long");
    expect(AI_FAILURE_COPY.art_timeout).not.toContain("rewords");
    expect(aiFailureMessage("art_timeout", 1)).toBe(
      "The image service is running slowly right now, so the artwork took too long. Try again in a few minutes. Your credit was returned.",
    );
  });
});
