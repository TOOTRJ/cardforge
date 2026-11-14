import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// A picture that NAMES its model (ImageCallOptions.model — Re-art deck's
// model picker, migration 0211).
//
//   * The named model paints ALONE: no default, no backup — a tester has to
//     know what painted, and the result says so.
//   * The picture's shape is asked the way THAT model takes it: FLUX.2 its
//     exact width × height; FLUX.1 Kontext the nearest ratio; Grok Imagine
//     and Gemini the nearest of the ratios they know (asked for one they
//     don't, they answer in their default shape or refuse).
//   * Gemini's image models answer a TEXT call with an image file: painted
//     through generateText, a stated refusal read as one.
//   * A picture that names no model is painted exactly as before.
//
// The gateway is MOCKED: each call is recorded and settled by the test.
// (Each model was tried once for real on the dev key, 2026-11-13: all five
// answered in the shape asked.)
// ---------------------------------------------------------------------------

type ImageCall = { kind: "image"; model: string; prompt: string; size?: string; aspectRatio?: string; providerOptions?: unknown };
type TextCall = { kind: "text"; model: string; prompt: string; providerOptions?: unknown };

const s = vi.hoisted(() => ({
  calls: [] as Array<ImageCall | TextCall>,
  /** What the next image call does, by model: "paint" (default) or an error message. */
  image: new Map<string, string>(),
  /** What the next text call answers. */
  text: null as null | { files: Array<{ mediaType: string; uint8Array: Uint8Array }>; finishReason?: string; text?: string } | { error: string },
}));

vi.mock("@/lib/ai/provider", () => ({ isGatewayConfigured: () => true }));
vi.mock("ai", () => ({
  experimental_generateImage: async (args: { model: string; prompt: string; size?: string; aspectRatio?: string; providerOptions?: unknown }) => {
    s.calls.push({ kind: "image", model: args.model, prompt: args.prompt, size: args.size, aspectRatio: args.aspectRatio, providerOptions: args.providerOptions });
    const outcome = s.image.get(args.model);
    if (outcome) throw new Error(outcome);
    return { image: { uint8Array: new Uint8Array([1, 2, 3]), mediaType: "image/jpeg" } };
  },
  generateText: async (args: { model: string; prompt: string; providerOptions?: unknown }) => {
    s.calls.push({ kind: "text", model: args.model, prompt: args.prompt, providerOptions: args.providerOptions });
    const answer = s.text ?? { files: [{ mediaType: "image/png", uint8Array: new Uint8Array([9]) }], finishReason: "stop" };
    if ("error" in answer) throw new Error(answer.error);
    return answer;
  },
}));

import {
  generateImageWithFallbacks,
  generatePlainImage,
  imageShapeArgs,
  isMultimodalImageModel,
  modelAspectRatio,
} from "@/lib/ai/image-gen";
import type { ArtShape } from "@/lib/ai/art-aspect";

const KONTEXT = "bfl/flux-kontext-pro";
const FLUX_PRO = "bfl/flux-2-pro";
const GROK = "spacexai/grok-imagine-image";
const GROK_2 = "spacexai/grok-imagine-image-2.0";
const GEMINI = "google/gemini-3.1-flash-image";

/** The M15 art window. */
const WINDOW: ArtShape = { windowAspect: 1.37, width: 1184, height: 864, aspectRatio: "4:3" };
const shape = (windowAspect: number): ArtShape => ({ windowAspect, width: 1024, height: 1024, aspectRatio: "1:1" });

beforeEach(() => {
  s.calls.length = 0;
  s.image.clear();
  s.text = null;
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("a named model paints alone", () => {
  it("is the only model called, and the result says who painted", async () => {
    const result = await generatePlainImage("A goblin.", WINDOW, { model: KONTEXT, timeoutMs: 150_000 });
    expect(result).toMatchObject({ ok: true, model: KONTEXT });
    expect(s.calls.map((call) => call.model)).toEqual([KONTEXT]);
  });

  it("gets no backup when it fails: the default model and its backup stay out of it", async () => {
    s.image.set(GROK, "429 Too Many Requests");
    const result = await generatePlainImage("A goblin.", WINDOW, { model: GROK, timeoutMs: 150_000 });
    expect(result.ok).toBe(false);
    expect(s.calls.map((call) => call.model)).toEqual([GROK]);
  });

  it("gets no timed hedge either, however long it takes", async () => {
    vi.useFakeTimers();
    try {
      const pending = generatePlainImage("A goblin.", WINDOW, { model: KONTEXT, timeoutMs: 150_000 });
      await vi.advanceTimersByTimeAsync(140_000);
      await pending;
      expect(s.calls.map((call) => call.model)).toEqual([KONTEXT]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("every rung of a prompt ladder is painted by it", async () => {
    s.image.set(KONTEXT, "Black Forest Labs generation failed: Request Moderated.");
    const result = await generateImageWithFallbacks(["As written.", "Dressed."], WINDOW, { model: KONTEXT, budgetMs: 150_000 });
    expect(result).toMatchObject({ ok: false, failure: "art_blocked" });
    expect(s.calls.map((call) => [call.model, call.prompt.split(" If any figure")[0]])).toEqual([
      [KONTEXT, "As written."],
      [KONTEXT, "Dressed."],
    ]);
  });

  it("a picture that names no model is painted as before: the default, with its backup when it fails", async () => {
    s.image.set("bfl/flux-2-flex", "429 Too Many Requests");
    const result = await generatePlainImage("A goblin.", WINDOW, { timeoutMs: 150_000 });
    expect(result).toMatchObject({ ok: true, model: FLUX_PRO });
    expect(s.calls.map((call) => call.model)).toEqual(["bfl/flux-2-flex", FLUX_PRO]);
    // An empty name is no name.
    s.calls.length = 0;
    s.image.clear();
    await generatePlainImage("A goblin.", WINDOW, { model: "  ", timeoutMs: 150_000 });
    expect(s.calls[0].model).toBe("bfl/flux-2-flex");
  });
});

describe("the shape is asked the way the model takes it", () => {
  it("FLUX.2 [pro]: the window's exact width × height, never a ratio", async () => {
    await generatePlainImage("A goblin.", WINDOW, { model: FLUX_PRO, timeoutMs: 150_000 });
    expect(s.calls[0]).toMatchObject({
      kind: "image",
      size: "1184x864",
      aspectRatio: undefined,
      providerOptions: { blackForestLabs: { width: 1184, height: 864 } },
    });
  });

  it("FLUX.1 Kontext: the nearest ratio, never a size it would ignore", async () => {
    await generatePlainImage("A goblin.", WINDOW, { model: KONTEXT, timeoutMs: 150_000 });
    expect(s.calls[0]).toMatchObject({ kind: "image", aspectRatio: "4:3", size: undefined, providerOptions: undefined });
    // It takes the wide and tall ends FLUX's ratio input takes.
    expect(modelAspectRatio(KONTEXT, 2.7)).toBe("21:9");
    expect(modelAspectRatio(KONTEXT, 0.417)).toBe("9:21");
  });

  it("Grok Imagine: only the ratios it knows — no 21 : 9 before 2.0, no 9 : 21 at all", () => {
    expect(imageShapeArgs(GROK, WINDOW)).toEqual({ aspectRatio: "4:3" });
    // The aftermath's wide window and the saga's tall one.
    expect(modelAspectRatio(GROK, 2.7)).toBe("20:9");
    expect(modelAspectRatio(GROK_2, 2.7)).toBe("21:9");
    expect(modelAspectRatio(GROK, 0.417)).toBe("9:20");
    expect(modelAspectRatio(GROK_2, 0.417)).toBe("9:20");
    expect(modelAspectRatio(GROK, 1)).toBe("1:1");
    expect(imageShapeArgs(GROK_2, shape(1.78))).toEqual({ aspectRatio: "16:9" });
  });

  it("Gemini: the ratios it knows — nothing narrower than 9 : 16", () => {
    expect(modelAspectRatio(GEMINI, 1.37)).toBe("4:3");
    expect(modelAspectRatio(GEMINI, 0.417)).toBe("9:16");
    expect(modelAspectRatio(GEMINI, 2.7)).toBe("21:9");
    expect(modelAspectRatio(GEMINI, 0.8)).toBe("4:5");
  });

  it("the named shapes are asked as they always were, whatever the model", () => {
    for (const model of [KONTEXT, GROK, GEMINI, FLUX_PRO, "bfl/flux-2-flex"]) {
      expect(imageShapeArgs(model, "square")).toEqual({ aspectRatio: "1:1" });
      expect(imageShapeArgs(model, "wide")).toEqual({ aspectRatio: "16:9" });
      expect(imageShapeArgs(model, "banner")).toEqual({ aspectRatio: "21:9" });
    }
  });

  it("a model nobody listed takes the ratios FLUX's ratio input takes (an AI_IMAGE_MODEL override, as before)", () => {
    expect(imageShapeArgs("vendor/some-model", WINDOW)).toEqual({ aspectRatio: "4:3" });
    expect(modelAspectRatio("vendor/some-model", 0.417)).toBe("9:21");
  });
});

describe("Gemini's image models answer a text call with an image file", () => {
  it("is painted through generateText, with the image modality and the ratio asked for", async () => {
    expect(isMultimodalImageModel(GEMINI)).toBe(true);
    expect(isMultimodalImageModel("google/gemini-2.5-flash-image")).toBe(true);
    expect(isMultimodalImageModel("google/gemini-3-pro")).toBe(false);
    expect(isMultimodalImageModel(KONTEXT)).toBe(false);

    const result = await generatePlainImage("A goblin.", WINDOW, { model: GEMINI, timeoutMs: 150_000 });
    expect(result).toMatchObject({ ok: true, model: GEMINI, contentType: "image/png" });
    expect(result.ok && [...result.bytes]).toEqual([9]);
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]).toMatchObject({
      kind: "text",
      model: GEMINI,
      providerOptions: { google: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: "4:3" } } },
    });
    // The clothed line is on its prompt too (added at the one door).
    expect(s.calls[0].prompt).toBe("A goblin. If any figure appears, it is fully clothed.");
  });

  it("a refusal it states walks the ladder; an answer with no picture for another reason does not", async () => {
    s.text = { files: [], finishReason: "content-filter" };
    const refused = await generateImageWithFallbacks(["As written.", "Dressed."], WINDOW, { model: GEMINI, budgetMs: 150_000 });
    expect(refused).toMatchObject({ ok: false, failure: "art_blocked", safetyBlocked: true });
    expect(s.calls).toHaveLength(2);

    s.calls.length = 0;
    s.text = { files: [], finishReason: "stop" };
    const empty = await generateImageWithFallbacks(["As written.", "Dressed."], WINDOW, { model: GEMINI, budgetMs: 150_000 });
    expect(empty).toMatchObject({ ok: false, failure: "art_failed", safetyBlocked: false });
    expect(s.calls).toHaveLength(1);
  });

  it("words in place of the picture are a refusal too (these models decline in text) — and never reach the log", async () => {
    const warned = vi.mocked(console.warn);
    s.text = { files: [], finishReason: "stop", text: "I can't create that image of a goblin, but I can describe one." };
    const declined = await generateImageWithFallbacks(["As written.", "Dressed."], WINDOW, { model: GEMINI, budgetMs: 150_000 });
    expect(declined).toMatchObject({ ok: false, failure: "art_blocked", safetyBlocked: true });
    // The softer prompt was tried.
    expect(s.calls).toHaveLength(2);
    expect(JSON.stringify(warned.mock.calls)).not.toMatch(/goblin|describe/);
    expect(JSON.stringify(warned.mock.calls)).toMatch(/text only/);
    // A picture that comes WITH words is a picture.
    s.calls.length = 0;
    s.text = { files: [{ mediaType: "image/png", uint8Array: new Uint8Array([7]) }], finishReason: "stop", text: "Here is your goblin." };
    const painted = await generatePlainImage("A goblin.", WINDOW, { model: GEMINI, timeoutMs: 150_000 });
    expect(painted).toMatchObject({ ok: true, model: GEMINI });
    // Blank text is no words: an empty answer is a failure, not a refusal.
    s.text = { files: [], finishReason: "stop", text: "  " };
    expect(await generatePlainImage("A goblin.", WINDOW, { model: GEMINI, timeoutMs: 150_000 })).toMatchObject({ ok: false, failure: "art_failed" });
  });

  it("a gateway error is reported as any model's, never thrown", async () => {
    s.text = { error: "429 Too Many Requests" };
    const result = await generatePlainImage("A goblin.", WINDOW, { model: GEMINI, timeoutMs: 150_000 });
    expect(result.ok).toBe(false);
    expect(s.calls.map((call) => call.model)).toEqual([GEMINI]);
  });
});
