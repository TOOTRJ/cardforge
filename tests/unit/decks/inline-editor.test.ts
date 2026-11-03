import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// The deck's edit drawer, server side and its switch (TODO DK5.18): who it
// is for (off / admins / everyone — off by default, no row = off), the
// `?edit=` value, and the gate every read and write behind it passes — the
// switch allows the viewer AND the deck is theirs; anything else is a 404,
// the page never offering it.
// ---------------------------------------------------------------------------

vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({
  profile: null as null | { id: string; is_admin: boolean },
  mode: "off" as string,
  deckRow: null as null | Record<string, unknown>,
  upsert: vi.fn(async () => ({ error: null })),
  deckFilters: [] as Array<[string, unknown]>,
}));
vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => unknown) => fn,
  updateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/public", () => ({
  createPublicClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: state.mode === "none" ? null : { value: { mode: state.mode } } }) }),
      }),
    }),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentProfile: async () => state.profile,
  createClient: async () => ({
    from: (table: string) => {
      if (table === "site_settings") return { upsert: state.upsert };
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          state.deckFilters.push([column, value]);
          return chain;
        },
        maybeSingle: async () => ({ data: state.deckRow }),
      };
      return chain;
    },
  }),
}));

import {
  canUseDeckInlineEditor,
  DEFAULT_DECK_INLINE_EDITOR_MODE,
  parseDeckEditParam,
  withDeckEditParam,
} from "@/lib/decks/inline-editor-shared";
import { getDeckInlineEditorMode, viewerUsesDeckInlineEditor } from "@/lib/decks/inline-editor";
import { ownDeckForInlineEditor } from "@/lib/decks/inline-editor-context";
import { setDeckInlineEditorModeAction } from "@/lib/decks/inline-editor-actions";

const USER = "11111111-1111-4111-8111-111111111111";
const DECK = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  state.profile = null;
  state.mode = "off";
  state.deckRow = null;
  state.deckFilters = [];
  state.upsert.mockClear();
});

describe("the switch", () => {
  it("is off by default, and 'admins' is the admins' alone", () => {
    expect(DEFAULT_DECK_INLINE_EDITOR_MODE).toBe("off");
    expect(canUseDeckInlineEditor("off", true)).toBe(false);
    expect(canUseDeckInlineEditor("admins", true)).toBe(true);
    expect(canUseDeckInlineEditor("admins", false)).toBe(false);
    expect(canUseDeckInlineEditor("everyone", false)).toBe(true);
  });

  it("reads no row, or a value it doesn't know, as off", async () => {
    state.mode = "none";
    expect(await getDeckInlineEditorMode()).toBe("off");
    state.mode = "sometimes";
    expect(await getDeckInlineEditorMode()).toBe("off");
  });

  it("asks the viewer's profile only for 'admins'", async () => {
    state.mode = "admins";
    state.profile = { id: USER, is_admin: false };
    expect(await viewerUsesDeckInlineEditor()).toBe(false);
    state.profile = { id: USER, is_admin: true };
    expect(await viewerUsesDeckInlineEditor()).toBe(true);
    state.mode = "everyone";
    state.profile = null;
    expect(await viewerUsesDeckInlineEditor()).toBe(true);
  });

  it("is set by an admin only, to a mode it knows", async () => {
    state.profile = { id: USER, is_admin: false };
    expect(await setDeckInlineEditorModeAction("everyone")).toEqual({ ok: false, error: "Not authorized." });
    state.profile = { id: USER, is_admin: true };
    expect(await setDeckInlineEditorModeAction("sometimes")).toEqual({ ok: false, error: "Unknown mode." });
    expect(state.upsert).not.toHaveBeenCalled();
    expect(await setDeckInlineEditorModeAction("admins")).toEqual({ ok: true });
    expect(state.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ key: "deck_inline_editor", value: { mode: "admins" }, updated_by: USER }),
      { onConflict: "key" },
    );
  });
});

describe("`?edit=`", () => {
  it("is an entry id or 'new' — nothing else opens the drawer", () => {
    expect(parseDeckEditParam("new")).toBe("new");
    expect(parseDeckEditParam("A0000000-0000-4000-A000-0000000006C9")).toBe("a0000000-0000-4000-a000-0000000006c9");
    expect(parseDeckEditParam("javascript:alert(1)")).toBeNull();
    expect(parseDeckEditParam("")).toBeNull();
    expect(parseDeckEditParam(null)).toBeNull();
  });

  it("is set and taken off keeping the rest of the URL", () => {
    expect(withDeckEditParam("/deck/ness?view=list#entry-1", "new")).toBe("/deck/ness?view=list&edit=new#entry-1");
    expect(withDeckEditParam("/deck/ness?edit=new&view=list", null)).toBe("/deck/ness?view=list");
    expect(withDeckEditParam("/deck/ness?edit=new", null)).toBe("/deck/ness");
  });
});

describe("the gate (the edit-context route and the save's revalidation)", () => {
  it("refuses a signed-out viewer, a viewer the switch doesn't allow, and a deck that isn't theirs", async () => {
    state.mode = "admins";
    expect(await ownDeckForInlineEditor(DECK)).toMatchObject({ status: 401 });
    state.profile = { id: USER, is_admin: false };
    expect(await ownDeckForInlineEditor(DECK)).toMatchObject({ status: 404 });
    state.profile = { id: USER, is_admin: true };
    expect(await ownDeckForInlineEditor(DECK)).toMatchObject({ status: 404 });
    // The read is held to the caller's own decks.
    expect(state.deckFilters).toEqual([
      ["id", DECK],
      ["owner_id", USER],
    ]);
    state.deckRow = { id: DECK, slug: "ness", title: "Ness", visibility: "public" };
    expect(await ownDeckForInlineEditor(DECK)).toEqual({ deck: state.deckRow, userId: USER });
  });

  it("is closed to everyone while the switch is off — admins too", async () => {
    state.profile = { id: USER, is_admin: true };
    state.deckRow = { id: DECK, slug: "ness", title: "Ness", visibility: "public" };
    expect(await ownDeckForInlineEditor(DECK)).toMatchObject({ status: 404 });
  });
});
