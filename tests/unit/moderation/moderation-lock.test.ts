import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// The moderation lock (migration 0156): the shared helper every go-public
// offer asks (lib/moderation/lock.ts — #706's deck offer included), the
// admin's Unhide (lib/moderation/actions.ts unhideCardAction → the definer
// admin_unhide_card, gated in the database AND here), the owner's
// notification copy, and the migration's own promises read from its text.
// ---------------------------------------------------------------------------

const CARD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER = "11111111-1111-4111-8111-111111111111";
const ADMIN = "99999999-9999-4999-8999-999999999999";

const s = vi.hoisted(() => ({
  profile: null as null | { id: string; is_admin: boolean },
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
  revalidateCardPaths: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  getCurrentProfile: async () => s.profile,
  getCurrentUser: async () => (s.profile ? { id: s.profile.id } : null),
  createClient: async () => ({ rpc: s.rpc }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => true,
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { slug: "grim" }, error: null }) }) }),
    }),
  }),
}));
vi.mock("@/lib/cards/revalidate", () => ({ revalidateCardPaths: s.revalidateCardPaths, purgeHiddenCard: vi.fn() }));
vi.mock("@/lib/profile/username", () => ({ lookupUsername: async () => "owner-handle" }));
vi.mock("next/cache", () => ({ revalidatePath: s.revalidatePath }));
vi.mock("@/lib/moderation/notify", () => ({ notifyAdminsOfReport: vi.fn() }));
vi.mock("@/lib/cards/bake-core", () => ({ CLEARED_RENDER_POINTERS: {}, removeRenderObjects: vi.fn() }));

import {
  HIDDEN_BY_MODERATION_LABEL,
  isModerationLockViolation,
  moderationLockReasonOf,
  moderationLockedSkippedLine,
  ownerVisibilityLabel,
} from "@/lib/moderation/lock";
import { unhideCardAction } from "@/lib/moderation/actions";
import { describeNotification } from "@/lib/notifications/describe";

beforeEach(() => {
  s.profile = { id: ADMIN, is_admin: true };
  s.rpc.mockReset();
  s.revalidatePath.mockReset();
  s.revalidateCardPaths.mockReset();
});

describe("moderationLockReasonOf — the one question a go-public offer asks", () => {
  it("names the lock only while moderation_hidden_at is set", () => {
    expect(moderationLockReasonOf({ moderation_hidden_at: "2026-10-29T00:00:00Z" })).toBe("moderation");
    expect(moderationLockReasonOf({ moderation_hidden_at: null })).toBeNull();
    expect(moderationLockReasonOf({})).toBeNull();
    expect(moderationLockReasonOf(null)).toBeNull();
  });

  it("the owner reads 'Hidden by moderation' in place of Private", () => {
    expect(ownerVisibilityLabel({ visibility: "private", moderation_hidden_at: "2026-10-29T00:00:00Z" })).toBe(HIDDEN_BY_MODERATION_LABEL);
    expect(ownerVisibilityLabel({ visibility: "private" })).toBe("Private");
    expect(ownerVisibilityLabel({ visibility: "public", moderation_hidden_at: null })).toBe("Public");
  });

  it("knows the CHECK's error and nothing else", () => {
    expect(isModerationLockViolation({ code: "23514", message: 'violates check constraint "cards_moderation_lock_private"' })).toBe(true);
    expect(isModerationLockViolation({ code: "23514", message: 'violates check constraint "cards_frame_preview_private"' })).toBe(false);
    expect(isModerationLockViolation(null)).toBe(false);
  });

  it("the bulk toast's line", () => {
    expect(moderationLockedSkippedLine(undefined)).toBe("");
    expect(moderationLockedSkippedLine(1)).toBe("1 card stayed private: it was hidden by moderation.");
    expect(moderationLockedSkippedLine(3)).toBe("3 cards stayed private: they were hidden by moderation.");
  });
});

describe("unhideCardAction — the admin's Unhide", () => {
  it("calls admin_unhide_card on the admin's session and refreshes the queue and the card", async () => {
    s.rpc.mockResolvedValue({ data: OWNER, error: null });
    expect(await unhideCardAction({ cardId: CARD })).toEqual({ ok: true });
    expect(s.rpc).toHaveBeenCalledWith("admin_unhide_card", { p_card_id: CARD });
    expect(s.revalidatePath).toHaveBeenCalledWith("/admin/moderation");
    // Never announced: the card stays private.
    expect(s.revalidateCardPaths).toHaveBeenCalledWith("grim", "owner-handle", { visibility: "private" });
  });

  it("a non-admin never reaches the database", async () => {
    s.profile = { id: OWNER, is_admin: false };
    expect(await unhideCardAction({ cardId: CARD })).toEqual({ ok: false, error: "Not authorized." });
    s.profile = null;
    expect(await unhideCardAction({ cardId: CARD })).toEqual({ ok: false, error: "Not authorized." });
    expect(s.rpc).not.toHaveBeenCalled();
  });

  it("a bad id, a card that wasn't locked, and the database's own refusal", async () => {
    expect(await unhideCardAction({ cardId: "nope" })).toEqual({ ok: false, error: "Invalid card id." });
    s.rpc.mockResolvedValue({ data: null, error: null });
    expect(await unhideCardAction({ cardId: CARD })).toMatchObject({ ok: false, error: expect.stringMatching(/isn't hidden/) });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    s.rpc.mockResolvedValue({ data: null, error: { message: "not_admin: only an admin unhides a card", code: "42501" } });
    expect(await unhideCardAction({ cardId: CARD })).toMatchObject({ ok: false, error: expect.stringMatching(/not_admin/) });
    log.mockRestore();
    expect(s.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("the owner's notification", () => {
  it("says the card is no longer hidden, stays private, and links to it", () => {
    const d = describeNotification(
      {
        type: "moderation_unhidden",
        actor: { username: "dev_admin", displayName: "Dev Admin" },
        card: { slug: "grim", title: "Grim Tidings", ownerUsername: "dev_pro" },
        threadId: null,
      },
      { isAdmin: false },
    );
    expect(d.subject).toBe("PipGlyph team");
    expect(d.body).toMatch(/Grim Tidings/);
    expect(d.body).toMatch(/stays private until you publish it/);
    expect(d.href).toBe("/card/dev_pro/grim");
  });
});

describe("migration 0156's promises", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/0156_moderation_lock.sql"), "utf8");

  it("a locked card is private for every role (CHECK), and API roles can't touch the columns (trigger)", () => {
    expect(sql).toMatch(/check \(moderation_hidden_at is null or visibility = 'private'\)/);
    expect(sql).toMatch(/current_user not in \('anon', 'authenticated'\)/);
    expect(sql).toMatch(/before insert or update of moderation_hidden_at, moderation_hidden_reason/);
    expect(sql).toMatch(/revoke all on function public\.guard_card_moderation_lock\(\) from public, anon, authenticated;/);
  });

  it("the unhide is admin-gated, notifies, and is never anon's", () => {
    expect(sql).toMatch(/security definer/);
    expect(sql).toMatch(/if not public\.viewer_is_admin\(\) then/);
    expect(sql).toMatch(/'moderation_unhidden'/);
    expect(sql).toMatch(/revoke all on function public\.admin_unhide_card\(uuid\) from public, anon;/);
    expect(sql).toMatch(/grant execute on function public\.admin_unhide_card\(uuid\) to authenticated, service_role;/);
  });

  it("the notification CHECK keeps every earlier kind", () => {
    const kinds = (text: string) => {
      const all = [...text.matchAll(/add constraint notifications_type_check\s+check \(\s*type in \(([\s\S]*?)\)\s*\)/g)];
      return [...all.at(-1)![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    };
    const before = kinds(readFileSync(join(process.cwd(), "supabase/migrations/0149_deck_tiles_trending.sql"), "utf8"));
    expect(kinds(sql)).toEqual([...before, "moderation_unhidden"]);
  });
});
