import { beforeEach, describe, expect, it, vi } from "vitest";

// The admin audit (2026-10-16): the moderation and message actions refuse a
// bad id, an unknown action and a missing admin key BEFORE any service-role
// client is made — nothing is written.

const s = vi.hoisted(() => ({
  isAdmin: true,
  configured: true,
  createAdminClient: vi.fn(() => {
    throw new Error("no service-role client may be made here");
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentProfile: async () => (s.isAdmin ? { id: "admin-1", is_admin: true } : { id: "u-1", is_admin: false }),
  getCurrentUser: async () => ({ id: "admin-1" }),
  createClient: async () => ({}),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: s.createAdminClient,
  isAdminConfigured: () => s.configured,
}));
vi.mock("@/lib/cards/revalidate", () => ({ revalidateCardPaths: vi.fn() }));
vi.mock("@/lib/moderation/hide-card", () => ({ hideCard: vi.fn() }));
vi.mock("@/lib/moderation/notify", () => ({ notifyAdminsOfReport: vi.fn() }));
vi.mock("@/lib/profile/username", () => ({ lookupUsername: async () => "someone" }));
vi.mock("@/lib/messages/notify", () => ({ emailUserAboutMessage: vi.fn() }));

import { resolveCardReportsAction, resolveCommentReportsAction } from "@/lib/moderation/actions";
import { adminMarkThreadReadAction, adminSetThreadStatusAction } from "@/lib/messages/actions";

const ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  s.isAdmin = true;
  s.configured = true;
  s.createAdminClient.mockClear();
});

describe("moderation actions", () => {
  it("refuse a non-admin", async () => {
    s.isAdmin = false;
    expect(await resolveCardReportsAction({ cardId: ID, action: "dismiss" })).toEqual({ ok: false, error: "Not authorized." });
    expect(await resolveCommentReportsAction({ commentId: ID, action: "dismiss" })).toEqual({ ok: false, error: "Not authorized." });
    expect(s.createAdminClient).not.toHaveBeenCalled();
  });

  it("refuse an unknown action instead of treating it as dismiss", async () => {
    const bogus = "delete-everything" as unknown as "dismiss";
    expect(await resolveCardReportsAction({ cardId: ID, action: bogus })).toEqual({ ok: false, error: "Unknown action." });
    expect(await resolveCommentReportsAction({ commentId: ID, action: bogus })).toEqual({ ok: false, error: "Unknown action." });
    expect(s.createAdminClient).not.toHaveBeenCalled();
  });

  it("answer a missing admin key with an error, never a thrown server action", async () => {
    s.configured = false;
    expect(await resolveCardReportsAction({ cardId: ID, action: "hide" })).toEqual({ ok: false, error: "Admin key is not configured." });
    expect(await resolveCommentReportsAction({ commentId: ID, action: "remove" })).toEqual({ ok: false, error: "Admin key is not configured." });
    expect(s.createAdminClient).not.toHaveBeenCalled();
  });
});

describe("admin message actions", () => {
  it("refuse a thread id that is not a uuid before any write", async () => {
    s.createAdminClient.mockImplementation(() => ({}) as never);
    expect(await adminSetThreadStatusAction("not-a-uuid", "closed")).toEqual({ ok: false, error: "No such conversation." });
    expect(await adminMarkThreadReadAction("not-a-uuid")).toEqual({ ok: false, error: "No such conversation." });
  });
});
