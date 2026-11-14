import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// A picture REPAINTED from another picture (lib/ai/image-gen.ts
// restyleWithFallbacks — Re-art deck's "from the card's own art", 0212).
//
//   * ONE model does it: the one named, else the app's one restyle model
//     (AI_IMAGE_REMIX_MODEL, default Gemini 2.5 Flash Image). No backup.
//   * An image model is handed the picture WITH the prompt (generateImage
//     `prompt.images`); a multimodal one as a message with the picture and
//     the words. Both are asked for the art window's shape the way the model
//     takes it.
//   * A refusal the provider states walks to the next, softer prompt, and is
//     told in a restyle's own words (a model can decline the PICTURE — two
//     declined one real card's art that four others repainted); anything
//     else stops.
//   * The picture goes to the model upright, with no camera metadata and at
//     most 2048 px — prepared ONCE, not once a prompt.
//
// The gateway is MOCKED. (Every model was tried for real on the dev key,
// 2026-11-14, on two real cards' art.)
// ---------------------------------------------------------------------------

type ImageCall = { kind: "image"; model: string; prompt: unknown; size?: string; aspectRatio?: string; providerOptions?: unknown };
type TextCall = { kind: "text"; model: string; messages: unknown; providerOptions?: unknown };

const s = vi.hoisted(() => ({
  calls: [] as Array<ImageCall | TextCall>,
  /** An image model's next answers, in order: "paint" or an error message. */
  image: [] as string[],
  /** A multimodal model's next answers, in order. */
  text: [] as Array<{ files: Array<{ mediaType: string; uint8Array: Uint8Array }>; finishReason?: string; text?: string } | { error: string }>,
  configured: true,
  prepared: [] as string[],
}));

vi.mock("@/lib/ai/provider", () => ({ isGatewayConfigured: () => s.configured }));
vi.mock("@/lib/media/orientation", () => ({
  autoOrientBytes: async (bytes: Uint8Array, contentType: string) => {
    s.prepared.push("upright");
    return { bytes, contentType };
  },
}));
vi.mock("@/lib/media/upload-bytes", () => ({
  imageWithoutMetadata: async (bytes: Uint8Array, contentType: string) => {
    s.prepared.push("no-metadata");
    return { bytes, contentType };
  },
}));
vi.mock("@/lib/media/model-input", () => ({
  modelInputImage: async (bytes: Uint8Array) => {
    s.prepared.push("model-size");
    // What the model is handed is what this step returns.
    return { bytes: new Uint8Array([...bytes, 99]), contentType: "image/jpeg", downscaled: false };
  },
}));
vi.mock("ai", () => ({
  experimental_generateImage: async (args: { model: string; prompt: unknown; size?: string; aspectRatio?: string; providerOptions?: unknown }) => {
    s.calls.push({ kind: "image", model: args.model, prompt: args.prompt, size: args.size, aspectRatio: args.aspectRatio, providerOptions: args.providerOptions });
    const outcome = s.image.shift() ?? "paint";
    if (outcome !== "paint") throw new Error(outcome);
    return { image: { uint8Array: new Uint8Array([1, 2, 3]), mediaType: "image/jpeg" } };
  },
  generateText: async (args: { model: string; messages: unknown; providerOptions?: unknown }) => {
    s.calls.push({ kind: "text", model: args.model, messages: args.messages, providerOptions: args.providerOptions });
    const answer = s.text.shift() ?? { files: [{ mediaType: "image/png", uint8Array: new Uint8Array([9]) }], finishReason: "stop" };
    if ("error" in answer) throw new Error(answer.error);
    return answer;
  },
}));

import { RESTYLE_BLOCKED_COPY, restyleModel, restyleWithFallbacks } from "@/lib/ai/image-gen";
import type { ArtShape } from "@/lib/ai/art-aspect";

const SOURCE = { bytes: new Uint8Array([7, 7, 7]), contentType: "image/jpeg" };
const WINDOW: ArtShape = { windowAspect: 1.37, width: 1184, height: 864, aspectRatio: "4:3" };
const CLOTHED = "If any figure appears, it is fully clothed.";
const REFUSED = "Black Forest Labs generation failed: Request Moderated.";

beforeEach(() => {
  s.calls.length = 0;
  s.image.length = 0;
  s.text.length = 0;
  s.prepared.length = 0;
  s.configured = true;
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("which model repaints", () => {
  it("none named: the app's one restyle model, with the picture and the words as a message", async () => {
    expect(restyleModel()).toBe("google/gemini-2.5-flash-image");
    const result = await restyleWithFallbacks(["Repaint it in gouache."], SOURCE, WINDOW);
    expect(result).toMatchObject({ ok: true, model: "google/gemini-2.5-flash-image", contentType: "image/png", promptIndex: 0 });
    expect(s.calls).toHaveLength(1);
    const [call] = s.calls as TextCall[];
    expect(call.kind).toBe("text");
    expect(call.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "image", image: new Uint8Array([7, 7, 7, 99]), mediaType: "image/jpeg" },
          { type: "text", text: `Repaint it in gouache. ${CLOTHED}` },
        ],
      },
    ]);
    // The art window's shape, the way Gemini takes it.
    expect(call.providerOptions).toEqual({ google: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: "4:3" } } });
  });

  it("the deployment's override is that model; a blank name is no name", async () => {
    vi.stubEnv("AI_IMAGE_REMIX_MODEL", "google/gemini-3.1-flash-image");
    expect(restyleModel()).toBe("google/gemini-3.1-flash-image");
    expect(restyleModel("  ")).toBe("google/gemini-3.1-flash-image");
    expect(restyleModel("bfl/flux-kontext-pro")).toBe("bfl/flux-kontext-pro");
    expect(await restyleWithFallbacks(["Repaint it."], SOURCE, WINDOW)).toMatchObject({ ok: true, model: "google/gemini-3.1-flash-image" });
  });

  it("a named image model is handed the picture WITH the prompt, in its own shape", async () => {
    const pro = await restyleWithFallbacks(["Repaint it."], SOURCE, WINDOW, { model: "bfl/flux-2-pro" });
    expect(pro).toMatchObject({ ok: true, model: "bfl/flux-2-pro", contentType: "image/jpeg" });
    await restyleWithFallbacks(["Repaint it."], SOURCE, WINDOW, { model: "bfl/flux-kontext-pro" });
    await restyleWithFallbacks(["Repaint it."], SOURCE, { ...WINDOW, windowAspect: 2.7 }, { model: "spacexai/grok-imagine-image" });
    const [flux, kontext, grok] = s.calls as ImageCall[];
    for (const call of [flux, kontext, grok]) {
      expect(call.kind).toBe("image");
      expect(call.prompt).toEqual({ text: `Repaint it. ${CLOTHED}`, images: [new Uint8Array([7, 7, 7, 99])] });
    }
    // FLUX.2: the window's exact size. Kontext and Grok: the nearest ratio each knows.
    expect(flux).toMatchObject({ size: "1184x864", providerOptions: { blackForestLabs: { width: 1184, height: 864 } } });
    expect(kontext).toMatchObject({ aspectRatio: "4:3", size: undefined });
    expect(grok).toMatchObject({ aspectRatio: "20:9", size: undefined });
  });

  it("has no backup: a model that fails is the only one called", async () => {
    s.image.push("429 Too Many Requests");
    const result = await restyleWithFallbacks(["Repaint it.", "Repaint it, dressed."], SOURCE, WINDOW, { model: "spacexai/grok-imagine-image-2.0" });
    expect(result).toMatchObject({ ok: false, safetyBlocked: false });
    expect(s.calls.map((call) => call.model)).toEqual(["spacexai/grok-imagine-image-2.0"]);
  });
});

describe("a refusal", () => {
  it("walks to the softer prompt, by the same model; the second prompt's picture is the answer", async () => {
    s.image.push(REFUSED, "paint");
    const result = await restyleWithFallbacks(["As written.", "Dressed."], SOURCE, WINDOW, { model: "bfl/flux-2-pro", budgetMs: 150_000 });
    expect(result).toMatchObject({ ok: true, promptIndex: 1, model: "bfl/flux-2-pro" });
    expect((s.calls as ImageCall[]).map((call) => (call.prompt as { text: string }).text)).toEqual([`As written. ${CLOTHED}`, `Dressed. ${CLOTHED}`]);
  });

  it("refused on every prompt: said in a restyle's own words — another model, or the prompt alone", async () => {
    s.image.push(REFUSED, REFUSED);
    const result = await restyleWithFallbacks(["As written.", "Dressed."], SOURCE, WINDOW, { model: "bfl/flux-2-pro", budgetMs: 150_000 });
    expect(result).toEqual({ ok: false, error: RESTYLE_BLOCKED_COPY, failure: "art_blocked", safetyBlocked: true });
    expect(RESTYLE_BLOCKED_COPY).toMatch(/declined to repaint this picture/);
    expect(RESTYLE_BLOCKED_COPY).toMatch(/another model/);
    expect(s.calls).toHaveLength(2);
  });

  it("a multimodal model declines in its finish reason or in words; an empty answer is a failure, not a refusal", async () => {
    s.text.push({ files: [], finishReason: "content-filter" }, { files: [], finishReason: "stop", text: "I can't repaint this artwork." });
    const declined = await restyleWithFallbacks(["As written.", "Dressed."], SOURCE, WINDOW, { budgetMs: 150_000 });
    expect(declined).toMatchObject({ ok: false, failure: "art_blocked", error: RESTYLE_BLOCKED_COPY });
    expect(s.calls).toHaveLength(2);
    // Never the model's words in the log.
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toMatch(/can't repaint/);

    s.calls.length = 0;
    s.text.push({ files: [], finishReason: "stop" });
    const empty = await restyleWithFallbacks(["As written.", "Dressed."], SOURCE, WINDOW, { budgetMs: 150_000 });
    expect(empty).toMatchObject({ ok: false, failure: "art_failed", safetyBlocked: false });
    expect(empty.ok === false && empty.error).not.toBe(RESTYLE_BLOCKED_COPY);
    expect(s.calls).toHaveLength(1);
  });
});

describe("what is never sent", () => {
  it("no prompt, no picture, no gateway: no call", async () => {
    expect(await restyleWithFallbacks([], SOURCE, WINDOW)).toMatchObject({ ok: false, failure: "art_failed" });
    expect(await restyleWithFallbacks(["   "], SOURCE, WINDOW)).toMatchObject({ ok: false, failure: "art_failed" });
    expect(await restyleWithFallbacks(["Repaint it."], { bytes: new Uint8Array(), contentType: "image/jpeg" }, WINDOW)).toMatchObject({ ok: false, failure: "art_failed" });
    s.configured = false;
    expect(await restyleWithFallbacks(["Repaint it."], SOURCE, WINDOW)).toMatchObject({ ok: false, failure: "ai_unavailable" });
    expect(s.calls).toHaveLength(0);
    expect(s.prepared).toHaveLength(0);
  });

  it("the picture is made upright, stripped of camera metadata and sized for the model ONCE — not once a prompt", async () => {
    s.image.push(REFUSED, "paint");
    await restyleWithFallbacks(["As written.", "Dressed."], SOURCE, WINDOW, { model: "bfl/flux-2-pro", budgetMs: 150_000 });
    expect(s.prepared).toEqual(["upright", "no-metadata", "model-size"]);
    expect(s.calls).toHaveLength(2);
  });

  it("a prompt past the door's limit keeps the clothed line at its end", async () => {
    const long = `${"Repaint it in thick oil paint, ".repeat(200)}the end.`;
    await restyleWithFallbacks([long], SOURCE, WINDOW, { model: "bfl/flux-2-pro" });
    const sent = ((s.calls[0] as ImageCall).prompt as { text: string }).text;
    expect(sent.length).toBeLessThanOrEqual(4000);
    expect(sent.endsWith(CLOTHED)).toBe(true);
  });
});
