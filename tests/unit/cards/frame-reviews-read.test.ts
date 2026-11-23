import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VerifiedFramesUnavailableError } from "@/lib/cards/frame-list-unavailable";

// ---------------------------------------------------------------------------
// The verified frame list is the creator's only gate. A read that FAILS (a
// PostgREST error, a pooler that refuses the connection — the 2026-11-10
// incident) is logged and thrown as VerifiedFramesUnavailableError, never
// answered as [] ("nothing is verified"): that answer showed every frame as
// "Soon" on /create and made both card actions refuse every save with "That
// frame isn't available in <colour> yet". Pages read it through
// readVerifiedFrameKeys(Public), which says `unavailable` instead of throwing.
// ---------------------------------------------------------------------------

type Answer = { data: unknown; error: { message: string } | null } | Error;

const state = vi.hoisted(() => ({
  configured: true,
  session: null as unknown,
  public: null as unknown,
  sessionCalls: 0,
  publicCalls: 0,
}));

function client(answer: Answer, count: () => void) {
  return {
    from: (table: string) => {
      expect(table).toBe("frame_reviews");
      count();
      return {
        select: () => ({
          eq: async () => {
            if (answer instanceof Error) throw answer;
            return answer;
          },
        }),
      };
    },
  };
}

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => state.configured }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.session }));
vi.mock("@/lib/supabase/public", () => ({ createPublicClient: () => state.public }));

import {
  getVerifiedFrameKeys,
  getVerifiedFrameKeysPublic,
  readVerifiedFrameKeys,
  readVerifiedFrameKeysPublic,
} from "@/lib/cards/frame-reviews";

const ROWS = [
  { template: "m15", color_key: "w", verified_layout_version: 70 },
  { template: "agclassic", color_key: "g", verified_layout_version: 48 },
];

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  state.configured = true;
  state.sessionCalls = 0;
  state.publicCalls = 0;
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const serve = (answer: Answer) => {
  state.session = client(answer, () => (state.sessionCalls += 1));
  state.public = client(answer, () => (state.publicCalls += 1));
};

describe("the verified frame list read", () => {
  it("answers the verified keys through the session client and the cookie-free one", async () => {
    serve({ data: ROWS, error: null });
    expect(await getVerifiedFrameKeys()).toEqual(expect.arrayContaining(["m15/w", "agclassic/g"]));
    expect(await getVerifiedFrameKeysPublic()).toEqual(expect.arrayContaining(["m15/w", "agclassic/g"]));
    expect([state.sessionCalls, state.publicCalls]).toEqual([1, 1]);
    expect(await readVerifiedFrameKeys()).toMatchObject({ unavailable: false, keys: expect.arrayContaining(["m15/w"]) });
    expect(await readVerifiedFrameKeysPublic()).toMatchObject({ unavailable: false, keys: expect.arrayContaining(["agclassic/g"]) });
    expect(errors).not.toHaveBeenCalled();
  });

  it("an empty list is an answer: nothing verified", async () => {
    serve({ data: [], error: null });
    expect(await getVerifiedFrameKeys()).toEqual([]);
    expect(await readVerifiedFrameKeysPublic()).toEqual({ keys: [], unavailable: false });
  });

  it.each([
    ["a PostgREST error", { data: null, error: { message: "upstream request timeout" } } as Answer],
    ["a thrown failure", new Error("Connection pool exhausted") as Answer],
  ])("%s is logged and thrown, never read as nothing verified", async (_label, answer) => {
    serve(answer);
    await expect(getVerifiedFrameKeys()).rejects.toBeInstanceOf(VerifiedFramesUnavailableError);
    await expect(getVerifiedFrameKeysPublic()).rejects.toBeInstanceOf(VerifiedFramesUnavailableError);
    expect(errors).toHaveBeenCalledTimes(2);
    expect(String(errors.mock.calls[0][0])).toMatch(/\[frame-reviews\] the verified frame list read failed \(session\)/);
    expect(String(errors.mock.calls[1][0])).toMatch(/\(public\)/);
    // The page form says so instead of throwing.
    expect(await readVerifiedFrameKeys()).toEqual({ keys: [], unavailable: true });
    expect(await readVerifiedFrameKeysPublic()).toEqual({ keys: [], unavailable: true });
  });

  it("reads nothing where Supabase isn't configured (local without a database)", async () => {
    state.configured = false;
    serve(new Error("must not be called"));
    expect(await getVerifiedFrameKeys()).toEqual([]);
    expect(await readVerifiedFrameKeysPublic()).toEqual({ keys: [], unavailable: false });
    expect([state.sessionCalls, state.publicCalls]).toEqual([0, 0]);
  });
});
