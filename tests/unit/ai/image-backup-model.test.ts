import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// The backup image model (owner 2026-10-28, feat/ai-art-backup-and-scan).
//
// FLUX.2 [flex] stays the default; FLUX.2 [pro] is started ONCE per picture,
// on the same prompt and shape, when the default has no answer after 60 s or
// as soon as it fails (a refusal included). The first picture wins, the other
// call is aborted, nothing outlives the caller's budget, and the result names
// the model that painted. Sampled on the dev key first (≤ 9 pictures):
// design-backup/ai-image-models/sheet.jpg.
//
// The gateway is MOCKED (`ai`'s experimental_generateImage): every call is a
// promise the test settles by hand, and it rejects when its signal aborts.
// Time is faked; AbortSignal.timeout is recorded, never fired (a timeout is
// played as the gateway's own timeout error).
// ---------------------------------------------------------------------------

type Call = {
  model: string;
  prompt: string;
  size?: string;
  providerOptions?: unknown;
  aborted: boolean;
  timeoutMs: number | null;
  paint: () => void;
  fail: (message: string) => void;
};

const s = vi.hoisted(() => ({ calls: [] as Call[], timeouts: [] as number[] }));

vi.mock("@/lib/ai/provider", () => ({ isGatewayConfigured: () => true }));
vi.mock("ai", () => ({
  experimental_generateImage: (args: {
    model: string;
    prompt: string;
    size?: string;
    providerOptions?: unknown;
    abortSignal: AbortSignal;
  }) =>
    new Promise((resolve, reject) => {
      const call: Call = {
        model: args.model,
        prompt: args.prompt,
        size: args.size,
        providerOptions: args.providerOptions,
        aborted: false,
        timeoutMs: s.timeouts.at(-1) ?? null,
        paint: () => resolve({ image: { uint8Array: new Uint8Array([s.calls.indexOf(call)]), mediaType: "image/jpeg" } }),
        fail: (message) => reject(new Error(message)),
      };
      args.abortSignal.addEventListener("abort", () => {
        call.aborted = true;
        reject(new Error("This operation was aborted"));
      });
      s.calls.push(call);
    }),
  generateText: async () => ({ files: [] }),
}));

import {
  CARD_STEP_IMAGE_BUDGET_MS,
  GATEWAY_IMAGE_BACKUP,
  IMAGE_BUDGET_MS,
  IMAGE_HEDGE_AT_MS,
  generateImageWithFallbacks,
  generatePlainImage,
  imageModels,
  withFullyClothedLine,
} from "@/lib/ai/image-gen";
import { FULLY_CLOTHED_LINE } from "@/lib/ai/art-prompt-safety";
import type { ArtShape } from "@/lib/ai/art-aspect";

const MODERATED = "Black Forest Labs generation failed: Request Moderated.";
const GATEWAY_TIMEOUT = "Gateway request failed: The operation was aborted due to timeout";
const BUSY = "429 Too Many Requests";
const SHAPE: ArtShape = { windowAspect: 0.77, width: 896, height: 1168, aspectRatio: "3:4" };
const LADDER = ["A vampire knight among burning ruins, blood on his blade.", "Softer.", "Safest."];

/** Let the promise chains run (fake timers: nothing else advances). */
const flush = () => vi.advanceTimersByTimeAsync(0);

const saved = { model: process.env.AI_IMAGE_MODEL, fallback: process.env.AI_IMAGE_FALLBACK_MODEL };
let info: ReturnType<typeof vi.spyOn>;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  delete process.env.AI_IMAGE_MODEL;
  delete process.env.AI_IMAGE_FALLBACK_MODEL;
  s.calls = [];
  s.timeouts = [];
  info = vi.spyOn(console, "info").mockImplementation(() => {});
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
    s.timeouts.push(ms);
    return new AbortController().signal;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const [key, value] of [
    ["AI_IMAGE_MODEL", saved.model],
    ["AI_IMAGE_FALLBACK_MODEL", saved.fallback],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("the models", () => {
  it("FLUX.2 [flex] stays the default; FLUX.2 [pro] is the backup — both through the gateway", () => {
    expect(imageModels()).toEqual({ primary: "bfl/flux-2-flex", backup: "bfl/flux-2-pro" });
    expect(GATEWAY_IMAGE_BACKUP).toBe("bfl/flux-2-pro");
    expect(IMAGE_HEDGE_AT_MS).toBe(60_000);
  });
  it("a backup named the same as the default is no backup", () => {
    process.env.AI_IMAGE_FALLBACK_MODEL = "bfl/flux-2-flex";
    expect(imageModels().backup).toBeNull();
  });
  it("a backup override must be a gateway FLUX.2 model; anything else is no backup, warned ONCE (review of #644)", () => {
    process.env.AI_IMAGE_FALLBACK_MODEL = "bfl/flux-2-max";
    expect(imageModels().backup).toBe("bfl/flux-2-max");
    for (const bad of ["bytedance/seedream-4.5", "openai/gpt-image-1", "flux-2-pro", "bfl/flux-pro-1.1"]) {
      warn.mockClear();
      process.env.AI_IMAGE_FALLBACK_MODEL = bad;
      expect(imageModels(), bad).toEqual({ primary: "bfl/flux-2-flex", backup: null });
      expect(imageModels().backup).toBeNull();
      expect(warn.mock.calls.filter((call: unknown[]) => String(call[0]).includes("AI_IMAGE_FALLBACK_MODEL")), bad).toHaveLength(1);
    }
  });
});

describe("the race", () => {
  it("the default answers first: one call, no backup, the default named", async () => {
    const out = generatePlainImage(LADDER[0], SHAPE, { timeoutMs: IMAGE_BUDGET_MS });
    await flush();
    await vi.advanceTimersByTimeAsync(12_000);
    s.calls[0].paint();
    const result = await out;
    expect(result).toMatchObject({ ok: true, model: "bfl/flux-2-flex" });
    // The 60 s timer was cleared with the answer: no backup later either.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(s.calls.map((c) => c.model)).toEqual(["bfl/flux-2-flex"]);
    expect(info.mock.calls.flat().join(" ")).toMatch(/painted by bfl\/flux-2-flex in 12 s/);
  });

  it("no answer by 60 s: the backup starts on the same prompt and shape, wins, and the default is aborted", async () => {
    const out = generatePlainImage(LADDER[0], SHAPE, { timeoutMs: IMAGE_BUDGET_MS });
    await flush();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(s.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.calls.map((c) => c.model)).toEqual(["bfl/flux-2-flex", "bfl/flux-2-pro"]);
    const [flex, pro] = s.calls;
    expect(pro.prompt).toBe(flex.prompt);
    expect(pro.prompt.endsWith(FULLY_CLOTHED_LINE)).toBe(true);
    expect(pro).toMatchObject({ size: "896x1168", providerOptions: { blackForestLabs: { width: 896, height: 1168 } } });
    await vi.advanceTimersByTimeAsync(10_000);
    pro.paint();
    const result = await out;
    expect(result).toMatchObject({ ok: true, model: "bfl/flux-2-pro" });
    expect(flex.aborted).toBe(true);
    expect(pro.aborted).toBe(false);
    const log = [...info.mock.calls, ...warn.mock.calls].flat().join(" ");
    expect(log).toMatch(/starting the backup bfl\/flux-2-pro after 60 s/);
    expect(log).toMatch(/painted by bfl\/flux-2-pro in 70 s \(backup\)/);
    expect(log).toMatch(/bfl\/flux-2-flex stopped .* the other model answered first/);
    // The loser's abort is not logged as the model failing.
    expect(log).not.toMatch(/flux-2-flex failed/);
  });

  it("the default answers after the backup started: the default wins, the backup is aborted", async () => {
    const out = generatePlainImage(LADDER[0], SHAPE, { timeoutMs: IMAGE_BUDGET_MS });
    await flush();
    await vi.advanceTimersByTimeAsync(75_000);
    const [flex, pro] = s.calls;
    flex.paint();
    expect(await out).toMatchObject({ ok: true, model: "bfl/flux-2-flex" });
    expect(pro.aborted).toBe(true);
  });

  it("the default fails before 60 s: the backup starts AT ONCE, once", async () => {
    const out = generatePlainImage(LADDER[0], SHAPE, { timeoutMs: IMAGE_BUDGET_MS });
    await flush();
    await vi.advanceTimersByTimeAsync(5_000);
    s.calls[0].fail(BUSY);
    await flush();
    expect(s.calls.map((c) => c.model)).toEqual(["bfl/flux-2-flex", "bfl/flux-2-pro"]);
    // The 60 s timer must not start a second backup.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.calls).toHaveLength(2);
    s.calls[1].paint();
    expect(await out).toMatchObject({ ok: true, model: "bfl/flux-2-pro" });
  });

  it("the default REFUSES: the backup paints the same prompt (the sample's dark prompt)", async () => {
    const out = generateImageWithFallbacks(LADDER, SHAPE);
    await flush();
    s.calls[0].fail(MODERATED);
    await flush();
    expect(s.calls[1]).toMatchObject({ model: "bfl/flux-2-pro", prompt: s.calls[0].prompt });
    s.calls[1].paint();
    expect(await out).toMatchObject({ ok: true, promptIndex: 0, model: "bfl/flux-2-pro" });
  });

  it("both refuse: the ladder walks to the softer prompt on the default ALONE — the backup is spent once", async () => {
    const out = generateImageWithFallbacks(LADDER, SHAPE);
    await flush();
    s.calls[0].fail(MODERATED);
    await flush();
    s.calls[1].fail(MODERATED);
    await flush();
    expect(s.calls.map((c) => c.model)).toEqual(["bfl/flux-2-flex", "bfl/flux-2-pro", "bfl/flux-2-flex"]);
    expect(s.calls[2].prompt).toBe(withFullyClothedLine(LADDER[1], 4000));
    // Rung 2 refused too: no backup this time, straight to rung 3.
    s.calls[2].fail(MODERATED);
    await flush();
    expect(s.calls.map((c) => c.model)).toEqual(["bfl/flux-2-flex", "bfl/flux-2-pro", "bfl/flux-2-flex", "bfl/flux-2-flex"]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.calls).toHaveLength(4);
    s.calls[3].paint();
    expect(await out).toMatchObject({ ok: true, promptIndex: 2, model: "bfl/flux-2-flex" });
  });

  it("both fail (slow window): the picture fails once — no reworded prompt, a timeout", async () => {
    const out = generateImageWithFallbacks(LADDER, SHAPE);
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(90_000);
    s.calls[1].fail(GATEWAY_TIMEOUT);
    await flush();
    // The backup gave up; the default is still on the wire: it may answer.
    s.calls[0].fail(GATEWAY_TIMEOUT);
    expect(await out).toMatchObject({ ok: false, failure: "art_timeout", safetyBlocked: false });
    expect(s.calls).toHaveLength(2);
  });

  it.each([
    ["a rate limit", BUSY],
    ["a 5xx", "500 Internal Server Error"],
    ["a model the gateway lacks", "Model not found: bfl/flux-2-pro"],
    ["a quick timeout", GATEWAY_TIMEOUT],
  ])("the default REFUSED and the backup failed with %s: the refusal — the ladder walks on (review of #644)", async (_, backupError) => {
    const out = generateImageWithFallbacks(LADDER, SHAPE);
    await flush();
    s.calls[0].fail(MODERATED);
    await flush();
    s.calls[1].fail(backupError);
    await flush();
    // ~150 s left: the softer rung runs, on the default alone.
    expect(s.calls.map((c) => c.model)).toEqual(["bfl/flux-2-flex", "bfl/flux-2-pro", "bfl/flux-2-flex"]);
    expect(s.calls[2].prompt).toBe(withFullyClothedLine(LADDER[1], 4000));
    s.calls[2].paint();
    expect(await out).toMatchObject({ ok: true, promptIndex: 1, model: "bfl/flux-2-flex" });
  });

  it("the BACKUP refused after the default failed otherwise: the refusal too", async () => {
    const out = generateImageWithFallbacks(LADDER, SHAPE);
    await flush();
    s.calls[0].fail(BUSY);
    await flush();
    s.calls[1].fail(MODERATED);
    await flush();
    expect(s.calls).toHaveLength(3);
    s.calls[2].paint();
    expect(await out).toMatchObject({ ok: true, promptIndex: 1 });
  });

  it("a refusal with too little budget left ends as art_blocked (MIN_RUNG_MS still bounds the ladder)", async () => {
    const out = generateImageWithFallbacks(LADDER, SHAPE);
    await flush();
    await vi.advanceTimersByTimeAsync(110_000);
    s.calls[0].fail(MODERATED);
    await flush();
    s.calls[1].fail(BUSY);
    expect(await out).toMatchObject({ ok: false, failure: "art_blocked", safetyBlocked: true });
    expect(s.calls).toHaveLength(2);
  });

  it("a gateway the deployment can't reach (credentials) never starts the backup", async () => {
    const out = generatePlainImage(LADDER[0], SHAPE, { timeoutMs: IMAGE_BUDGET_MS });
    await flush();
    s.calls[0].fail("401 Unauthorized: invalid api key");
    expect(await out).toMatchObject({ ok: false, failure: "ai_unavailable" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.calls).toHaveLength(1);
  });

  it("no backup configured: the default alone, as #641 left it", async () => {
    process.env.AI_IMAGE_FALLBACK_MODEL = "bfl/flux-2-flex";
    const out = generatePlainImage(LADDER[0], SHAPE, { timeoutMs: IMAGE_BUDGET_MS });
    await flush();
    await vi.advanceTimersByTimeAsync(61_000);
    expect(s.calls).toHaveLength(1);
    s.calls[0].fail(BUSY);
    expect(await out).toMatchObject({ ok: false, failure: "art_busy" });
    expect(s.calls).toHaveLength(1);
  });
});

describe("the budget", () => {
  it("a fill's 150 s: the default may wait it all, the backup gets what is left at 60 s", async () => {
    const out = generateImageWithFallbacks(LADDER, SHAPE);
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.calls[0].timeoutMs).toBeLessThanOrEqual(IMAGE_BUDGET_MS);
    expect(s.calls[0].timeoutMs).toBeGreaterThan(IMAGE_BUDGET_MS - 1_000);
    expect(s.calls[1].timeoutMs).toBeLessThanOrEqual(IMAGE_BUDGET_MS - 60_000);
    expect(s.calls[1].timeoutMs).toBeGreaterThan(IMAGE_BUDGET_MS - 61_000);
    s.calls[1].paint();
    await out;
  });

  it("a card step's 140 s: the backup gets 80 s", async () => {
    const out = generateImageWithFallbacks(LADDER, SHAPE, { budgetMs: CARD_STEP_IMAGE_BUDGET_MS });
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.calls[1].timeoutMs).toBeLessThanOrEqual(CARD_STEP_IMAGE_BUDGET_MS - 60_000);
    expect(s.calls[1].timeoutMs).toBeGreaterThan(CARD_STEP_IMAGE_BUDGET_MS - 61_000);
    s.calls[1].paint();
    await out;
  });

  it("a backup started on a late failure gets only what is left of the SAME deadline", async () => {
    const out = generatePlainImage(LADDER[0], SHAPE, { timeoutMs: 60_000 });
    await flush();
    await vi.advanceTimersByTimeAsync(30_000);
    s.calls[0].fail(BUSY);
    await flush();
    expect(s.calls[1].timeoutMs).toBeLessThanOrEqual(30_000);
    s.calls[1].paint();
    await out;
  });

  it("a budget too short for a timed hedge (the remix's 60 s) has none; and no backup with < 20 s left", async () => {
    const out = generatePlainImage(LADDER[0], SHAPE, { timeoutMs: 60_000 });
    await flush();
    await vi.advanceTimersByTimeAsync(45_000);
    expect(s.calls).toHaveLength(1);
    s.calls[0].fail(BUSY);
    // 15 s left: the backup could not finish, so it is not started.
    expect(await out).toMatchObject({ ok: false, failure: "art_busy" });
    expect(s.calls).toHaveLength(1);
  });
});
