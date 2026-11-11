// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

// ---------------------------------------------------------------------------
// A kit token's picture, as the tool's analytics see it (the 2026-11-10 tools
// audit). The upload is the creator's own and the AI picture's outcome
// arrives in the browser, so the Token Kit's BROWSER records both
// (components/tools/token-kit/use-kit-art.ts → trackToolEvent):
//   - `art_uploaded` / `art_upload_failed` (a reason code, the file's kB);
//   - `ai_art_done` (the credit spent) / `ai_art_failed` (a reason code, and
//     whether the credit came back).
// Codes, sizes and counts only: never the token's words or the file's name.
// And never in the picture's way: a tracking call that fails changes nothing.
// ---------------------------------------------------------------------------

const m = vi.hoisted(() => ({
  track: vi.fn(),
  upload: vi.fn(),
  confirm: vi.fn(),
  upgrade: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/tools/track-client", () => ({ trackToolEvent: m.track }));
vi.mock("@/lib/cards/art-upload-client", () => ({ uploadCardArtFile: m.upload }));
vi.mock("@/components/billing/credit-confirm-provider", () => ({ useCreditConfirm: () => m.confirm }));
vi.mock("@/components/billing/credits-bus", () => ({ publishCredits: vi.fn() }));
vi.mock("@/components/billing/upgrade-modal-provider", () => ({ useUpgradeModal: () => ({ open: m.upgrade }) }));
vi.mock("sonner", () => ({ toast: { error: m.toastError, success: vi.fn() } }));

import { useKitArt } from "@/components/tools/token-kit/use-kit-art";
import { CARD_ART_TOO_LARGE_MESSAGE, CARD_ART_TYPE_MESSAGE, CARD_ART_UPLOAD_FAILED_MESSAGE } from "@/lib/cards/art-upload-limits";
import { DEFAULT_KIT_SETTINGS, type KitFace } from "@/lib/tools/token-kit/model";

const FACE: KitFace = {
  kind: "token",
  title: "Secret Goblin",
  typeWords: "Creature",
  subtypes: ["Goblin"],
  colors: ["red"],
  rulesText: "Haste",
  flavorText: null,
  power: "1",
  toughness: "1",
};

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const tracked = () => m.track.mock.calls.map(([slug, event, props]) => [slug, event, props]);
const file = (bytes: number) => new File([new Uint8Array(bytes)], "my-secret-holiday.png", { type: "image/png" });

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.track.mockReturnValue(undefined);
  m.confirm.mockResolvedValue(true);
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("an upload", () => {
  it("records `art_uploaded` with the file's size — never its name", async () => {
    m.upload.mockResolvedValue({ ok: true, publicUrl: "https://x/card-art/u1/a.png" });
    const { result } = renderHook(() => useKitArt());
    let picture: unknown;
    await act(async () => {
      picture = await result.current.upload("token-1", file(3 * 1024 * 1024));
    });
    expect(picture).toEqual({ artUrl: "https://x/card-art/u1/a.png", artistCredit: null });
    expect(tracked()).toEqual([["token-kit", "art_uploaded", { kb: 3072 }]]);
    expect(JSON.stringify(m.track.mock.calls)).not.toMatch(/holiday/);
  });

  it("a refused upload is `art_upload_failed` with a reason read from the upload's own sentence", async () => {
    const { result } = renderHook(() => useKitArt());
    for (const message of [CARD_ART_TOO_LARGE_MESSAGE, CARD_ART_TYPE_MESSAGE, CARD_ART_UPLOAD_FAILED_MESSAGE, "You're uploading too fast."]) {
      m.upload.mockResolvedValueOnce({ ok: false, error: message });
      await act(async () => {
        expect(await result.current.upload("token-1", file(2048))).toBeNull();
      });
    }
    expect(tracked().map(([, event, props]) => [event, props])).toEqual([
      ["art_upload_failed", { reason: "too_large", kb: 2 }],
      ["art_upload_failed", { reason: "wrong_type", kb: 2 }],
      ["art_upload_failed", { reason: "upload_failed", kb: 2 }],
      ["art_upload_failed", { reason: "refused", kb: 2 }],
    ]);
    // The user is still told, in words.
    expect(m.toastError).toHaveBeenCalledTimes(4);
  });
});

describe("an AI picture", () => {
  const paint = async () => {
    const { result } = renderHook(() => useKitArt());
    let picture: unknown;
    await act(async () => {
      picture = await result.current.paint("token-1", FACE, "m20token", DEFAULT_KIT_SETTINGS);
    });
    return picture;
  };
  const plan = () => json({ ok: true, credits: 5, job: { id: "job-1" } });
  const step = (fill: Record<string, unknown>) => json({ ok: true, credits: 4, job: { steps: [{ key: "fill:0", ...fill }] } });
  const lastEvent = () => tracked().at(-1) as [string, string, Record<string, unknown>];

  it("painted: `ai_art_done` with the credit spent, the kit's style and how long it took", async () => {
    fetchMock
      .mockResolvedValueOnce(plan())
      .mockResolvedValueOnce(
        step({ status: "done", spend_ref: "spend:job-1:fill:0:x", fill: { art_url: "https://x/card-art/u1/ai-1.png", artist_credit: "AI" } }),
      );
    expect(await paint()).toEqual({ artUrl: "https://x/card-art/u1/ai-1.png", artistCredit: "AI" });
    expect(tracked()).toEqual([["token-kit", "ai_art_done", { kind: "token", style: "classic-oil", credits: 1, ms: expect.any(Number) }]]);
    expect(JSON.stringify(m.track.mock.calls)).not.toMatch(/Secret Goblin|Haste|job-1/);
  });

  it("painted with nothing charged (an admin, billing off): zero credits", async () => {
    fetchMock.mockResolvedValueOnce(plan()).mockResolvedValueOnce(step({ status: "done", spend_ref: null, fill: { art_url: "https://x/card-art/u1/ai-2.png" } }));
    expect(await paint()).toEqual({ artUrl: "https://x/card-art/u1/ai-2.png", artistCredit: null });
    expect(tracked()).toEqual([["token-kit", "ai_art_done", { kind: "token", style: "classic-oil", credits: 0, ms: expect.any(Number) }]]);
  });

  it("declined at the confirm: nothing asked, nothing recorded", async () => {
    m.confirm.mockResolvedValue(false);
    expect(await paint()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(m.track).not.toHaveBeenCalled();
  });

  it("out of credits at the plan: its own reason, nothing charged, the upgrade prompt as before", async () => {
    fetchMock.mockResolvedValueOnce(json({ ok: false, code: "INSUFFICIENT_CREDITS" }, 402));
    expect(await paint()).toBeNull();
    expect(lastEvent()).toEqual([
      "token-kit",
      "ai_art_failed",
      { reason: "insufficient_credits", kind: "token", style: "classic-oil", status: 402, refunded: false, ms: expect.any(Number) },
    ]);
    expect(m.upgrade).toHaveBeenCalledWith("credits", "token_kit");
    expect(m.toastError).not.toHaveBeenCalled();
  });

  it("a plan the rate limit or the route refused", async () => {
    fetchMock.mockResolvedValueOnce(json({ ok: false, error: "Slow down." }, 429));
    await paint();
    expect(lastEvent()[2]).toMatchObject({ reason: "rate_limited", status: 429 });
    fetchMock.mockResolvedValueOnce(json({ ok: false, error: "Not open to you." }, 403));
    await paint();
    expect(lastEvent()[2]).toMatchObject({ reason: "plan_refused", status: 403 });
    expect(m.upgrade).not.toHaveBeenCalled();
  });

  it("a failed step says its failure kind and what happened to the credit", async () => {
    fetchMock
      .mockResolvedValueOnce(plan())
      .mockResolvedValueOnce(step({ status: "failed", error: "Blocked.", failure: "art_blocked", refunded: 1, refund_pending: false }));
    expect(await paint()).toBeNull();
    expect(lastEvent()).toEqual([
      "token-kit",
      "ai_art_failed",
      { reason: "art_blocked", kind: "token", style: "classic-oil", refunded: true, refund_pending: false, ms: expect.any(Number) },
    ]);

    fetchMock
      .mockResolvedValueOnce(plan())
      .mockResolvedValueOnce(step({ status: "failed", error: "Timed out.", failure: "art_timeout", refunded: 0, refund_pending: true }));
    await paint();
    expect(lastEvent()[2]).toMatchObject({ reason: "art_timeout", refunded: false, refund_pending: true });

    // A kind the step doesn't name (an older step) is a plain step failure.
    fetchMock.mockResolvedValueOnce(plan()).mockResolvedValueOnce(step({ status: "failed", error: "Something the server said." }));
    await paint();
    expect(lastEvent()[2]).toMatchObject({ reason: "step_failed", refunded: false });
    expect(JSON.stringify(m.track.mock.calls)).not.toMatch(/Something the server said|Blocked/);
  });

  it("a step door that refused, a step with no picture, and a dropped connection", async () => {
    fetchMock.mockResolvedValueOnce(plan()).mockResolvedValueOnce(json({ ok: false, error: "Gone." }, 404));
    await paint();
    expect(lastEvent()[2]).toMatchObject({ reason: "step_refused", status: 404 });

    fetchMock.mockResolvedValueOnce(plan()).mockResolvedValueOnce(step({ status: "done", fill: {} }));
    await paint();
    expect(lastEvent()[2]).toMatchObject({ reason: "no_answer" });

    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await paint();
    expect(lastEvent()[2]).toMatchObject({ reason: "no_connection" });
    // Every one of them an `ai_art_failed` of the Token Kit; none a success.
    expect(tracked().every(([slug, event]) => slug === "token-kit" && event === "ai_art_failed")).toBe(true);
  });
});
