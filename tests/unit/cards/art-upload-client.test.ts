import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// The browser half of a card-art upload (TODO 6.10): the early check, then
// start → PUT to the signed URL in the PRIVATE staging bucket → finish. A
// print-size file (8–15 MiB) never rides a server action's body — Vercel caps
// a Function's request body at 4.5 MB — and the flow never throws: every
// failure comes back as a message the uploader can toast.
// ---------------------------------------------------------------------------

const MIB = 1024 * 1024;

const browser = vi.hoisted(() => ({
  buckets: [] as string[],
  puts: [] as { path: string; token: string; file: File; opts: unknown }[],
  putError: null as null | { message?: string; statusCode?: string | number },
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    storage: {
      from: (bucket: string) => {
        browser.buckets.push(bucket);
        return {
          uploadToSignedUrl: async (path: string, token: string, file: File, opts: unknown) => {
            browser.puts.push({ path, token, file, opts });
            return browser.putError ? { data: null, error: browser.putError } : { data: { path, fullPath: path }, error: null };
          },
        };
      },
    },
  }),
}));

const actions = vi.hoisted(() => ({
  start: vi.fn(),
  finish: vi.fn(),
}));
vi.mock("@/lib/cards/upload-art-server", () => ({
  startCardArtUploadAction: actions.start,
  finishCardArtUploadAction: actions.finish,
}));

import { stagedUploadError, uploadCardArtFile } from "@/lib/cards/art-upload-client";

const USER = "11111111-1111-4111-8111-111111111111";
const NAME = "22222222-2222-4222-8222-222222222222.upload";
const STARTED = { ok: true, name: NAME, path: `${USER}/${NAME}`, token: "signed-token" };
const DONE = { ok: true, publicUrl: `https://storage.test/card-art/${USER}/a.png`, path: `${USER}/a.png` };

const png = (size: number) => new File([new Uint8Array(size)], "art.png", { type: "image/png" });

beforeEach(() => {
  browser.buckets.length = 0;
  browser.puts.length = 0;
  browser.putError = null;
  actions.start.mockReset().mockResolvedValue(STARTED);
  actions.finish.mockReset().mockResolvedValue(DONE);
});

describe("uploadCardArtFile", () => {
  it("uploads a 12 MiB PNG: start → PUT into the private staging bucket → finish", async () => {
    const file = png(12 * MIB);
    expect(await uploadCardArtFile(file)).toEqual(DONE);
    expect(actions.start).toHaveBeenCalledWith({ size: 12 * MIB, type: "image/png" });
    expect(browser.buckets).toEqual(["card-art-incoming"]);
    expect(browser.puts).toHaveLength(1);
    expect(browser.puts[0]).toMatchObject({ path: STARTED.path, token: "signed-token", opts: { contentType: "image/png", upsert: false } });
    expect(browser.puts[0].file).toBe(file);
    expect(actions.finish).toHaveBeenCalledWith(NAME);
  });

  it("refuses a file over 20 MB — and a non-image — before any call", async () => {
    expect(await uploadCardArtFile(png(20 * MIB + 1))).toEqual({ ok: false, error: "That image is over 20 MB. Pick a smaller file." });
    expect(await uploadCardArtFile(new File(["x"], "a.txt", { type: "text/plain" }))).toEqual({
      ok: false,
      error: "That doesn't look like an image.",
    });
    expect(actions.start).not.toHaveBeenCalled();
    expect(browser.puts).toEqual([]);
  });

  it("passes the start action's refusal through (the rate limit's typed error included) and stops", async () => {
    const limited = { ok: false, error: "You're uploading too fast — try again in a minute.", code: "UPLOAD_RATE_LIMITED", retryAfterSeconds: 17 };
    actions.start.mockResolvedValue(limited);
    expect(await uploadCardArtFile(png(1000))).toEqual(limited);
    expect(browser.puts).toEqual([]);
    expect(actions.finish).not.toHaveBeenCalled();
  });

  it("a refused PUT is a message, and no finish is attempted", async () => {
    browser.putError = { statusCode: "413", message: "The object exceeded the maximum allowed size" };
    expect(await uploadCardArtFile(png(1000))).toEqual({ ok: false, error: "Image must be 20 MB or smaller." });
    browser.putError = { statusCode: "415", message: "mime type image/png is not supported" };
    expect(await uploadCardArtFile(png(1000))).toEqual({ ok: false, error: "Only PNG, JPEG, WebP, and GIF images are allowed." });
    browser.putError = { statusCode: "400", message: "invalid signature" };
    expect(await uploadCardArtFile(png(1000))).toEqual({
      ok: false,
      error: "The upload didn't go through — check your connection and try again.",
    });
    expect(actions.finish).not.toHaveBeenCalled();
  });

  it("the finish action's answer is the result (a flagged image included)", async () => {
    const flagged = { ok: false, error: "That image was flagged by our content filter and can't be uploaded." };
    actions.finish.mockResolvedValue(flagged);
    expect(await uploadCardArtFile(png(1000))).toEqual(flagged);
  });

  it("never throws: a dropped connection anywhere is a message", async () => {
    for (const fail of ["start", "put", "finish"] as const) {
      const deps = {
        start: fail === "start" ? () => Promise.reject(new Error("network")) : actions.start,
        put: fail === "put" ? () => Promise.reject(new Error("network")) : undefined,
        finish: fail === "finish" ? () => Promise.reject(new Error("network")) : actions.finish,
      };
      expect(await uploadCardArtFile(png(1000), deps), fail).toEqual({
        ok: false,
        error: "The upload didn't go through — check your connection and try again.",
      });
    }
  });
});

describe("stagedUploadError", () => {
  it("maps Storage's refusals to the uploader's words", () => {
    expect(stagedUploadError({ status: 413 })).toBe("Image must be 20 MB or smaller.");
    expect(stagedUploadError({ message: "Payload too large" })).toBe("Image must be 20 MB or smaller.");
    expect(stagedUploadError({ statusCode: 415 })).toBe("Only PNG, JPEG, WebP, and GIF images are allowed.");
    expect(stagedUploadError({})).toBe("The upload didn't go through — check your connection and try again.");
  });
});
