import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BUILT_IN_COVER_UNAVAILABLE_MESSAGE,
  MEDIA_URL_NOT_ALLOWED_MESSAGE,
  refusedDeckCoverMessage,
} from "@/lib/media/media-url-errors";

// ---------------------------------------------------------------------------
// A cover the 0127 guard refuses (`media_url_not_allowed: decks.cover_url`)
// is a field error on the cover — and an honest one: a built-in background
// (0150) is refused only by a database 0150 hasn't reached (a preview
// branch, the dev database before its migrate), where "That picture isn't
// one of your uploads — upload it again" asks for an upload that was never
// made. Both deck actions, create and update.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const DECK = "22222222-2222-4222-8222-222222222222";
const BUILT_IN = "/defaults/deck-covers/red-1.webp";
const OTHER_HOST = "https://elsewhere.example/cover.webp";
const GUARD = "media_url_not_allowed: decks.cover_url must be one of your own uploads";

const s = vi.hoisted(() => ({ writes: 0 }));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {} }));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/decks/revalidate", () => ({ revalidateDeckPaths: () => {} }));
vi.mock("@/lib/decks/queries", () => ({
  getDeckById: async () => ({ id: "22222222-2222-4222-8222-222222222222", owner_id: "11111111-1111-4111-8111-111111111111", slug: "my-deck" }),
}));
vi.mock("@/lib/supabase/admin", () => ({ isAdminConfigured: () => false, createAdminClient: () => ({}) }));
vi.mock("@/lib/analytics/funnel-server", () => ({ recordFunnelEvent: async () => "row" }));
vi.mock("@/lib/decks/membership", () => ({ addCustomCardEntryToDeck: async () => ({ ok: true }) }));

function table() {
  const q = {
    select: () => q,
    eq: () => q,
    insert: () => q,
    update: () => q,
    // The guard refuses the write (insufficient_privilege).
    single: async () => {
      s.writes += 1;
      return { data: null, error: { code: "42501", message: GUARD } };
    },
  };
  return q;
}

vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => ({ id: USER }),
  getCurrentUsername: async () => "me",
  createClient: async () => ({ from: () => table() }),
}));

import { createDeckAction, updateDeckAction } from "@/lib/decks/actions";

beforeEach(() => {
  s.writes = 0;
});

describe("refusedDeckCoverMessage", () => {
  it("a built-in background: not available here yet — never 'upload it again'", () => {
    expect(refusedDeckCoverMessage(BUILT_IN)).toBe(BUILT_IN_COVER_UNAVAILABLE_MESSAGE);
    expect(BUILT_IN_COVER_UNAVAILABLE_MESSAGE).toBe("Built-in backgrounds aren't available here yet.");
    expect(BUILT_IN_COVER_UNAVAILABLE_MESSAGE).not.toMatch(/upload/i);
  });

  it.each([OTHER_HOST, "/defaults/deck-covers/red-9.webp", null, undefined])("anything else (%j): the upload message", (url) => {
    expect(refusedDeckCoverMessage(url)).toBe(MEDIA_URL_NOT_ALLOWED_MESSAGE);
  });
});

describe("the deck actions put it on the cover field", () => {
  it("createDeckAction, a built-in background", async () => {
    const result = await createDeckAction({ title: "Red Deck", cover_url: BUILT_IN });
    expect(s.writes).toBe(1);
    expect(result).toEqual({ ok: false, fieldErrors: { cover_url: "Built-in backgrounds aren't available here yet." } });
  });

  it("createDeckAction, a picture that isn't the user's", async () => {
    const result = await createDeckAction({ title: "Red Deck", cover_url: OTHER_HOST });
    expect(result).toEqual({ ok: false, fieldErrors: { cover_url: MEDIA_URL_NOT_ALLOWED_MESSAGE } });
  });

  it("updateDeckAction, a built-in background", async () => {
    const result = await updateDeckAction(DECK, { cover_url: BUILT_IN });
    expect(s.writes).toBe(1);
    expect(result).toEqual({ ok: false, fieldErrors: { cover_url: "Built-in backgrounds aren't available here yet." } });
  });

  it("updateDeckAction, a picture that isn't the user's", async () => {
    const result = await updateDeckAction(DECK, { cover_url: OTHER_HOST });
    expect(result).toEqual({ ok: false, fieldErrors: { cover_url: MEDIA_URL_NOT_ALLOWED_MESSAGE } });
  });
});
