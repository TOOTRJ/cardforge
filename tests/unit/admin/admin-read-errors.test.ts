import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chainClient, type ChainAnswer, type ChainCall } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// Admin reads that used to swallow an error into an empty state (audit L5):
// a failed read is LOGGED and FLAGGED (`loadError`), so the page shows its
// inline "Couldn't load …" instead of "Inbox zero" / "No flagged cards" /
// "No conversations yet". And the moderation queue's tiles (L6): each item
// carries the whole card row (BakedCardThumbnail's thumb) and a link to it.
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({
  resolve: null as null | ((table: string, calls: ChainCall[]) => ChainAnswer),
  rpc: null as null | ((name: string, args: Record<string, unknown>) => ChainAnswer),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentProfile: async () => ({ id: "admin", is_admin: true }),
  getCurrentUser: async () => ({ id: "admin" }),
  createClient: async () => {
    throw new Error("not in this test");
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => true,
  createAdminClient: () => {
    const stub = chainClient((table, calls) => state.resolve!(table, calls));
    return {
      ...stub.client,
      rpc: async (name: string, args: Record<string, unknown>) => ({ data: null, error: null, ...state.rpc!(name, args) }),
    };
  },
}));

import { listAllFeedback } from "@/lib/feedback/queries";
import { listAllThreads, listThreadsForUser, threadIdsForFeedback } from "@/lib/messages/queries";
import { getCommentModerationQueue, getModerationQueue } from "@/lib/moderation/queries";
import { listAdminUsers } from "@/lib/admin/users-queries";
import { parseUserListParams } from "@/lib/admin/users-params";

const FAIL = { data: null, error: { message: "boom" } };
let log: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  log = vi.spyOn(console, "error").mockImplementation(() => {});
  state.resolve = () => ({ data: [] });
  state.rpc = () => ({ data: [] });
});
afterEach(() => log.mockRestore());

describe("feedback inbox", () => {
  it("flags and logs a failed read — never an empty inbox as the truth", async () => {
    state.resolve = () => FAIL;
    expect(await listAllFeedback("all")).toEqual({ items: [], loadError: true });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("feedback read failed"), "boom");
  });

  it("flags a failed sender read (every sender would read 'deleted account')", async () => {
    state.resolve = (table) =>
      table === "feedback"
        ? {
            data: [
              { id: "f1", category: "bug", subject: "S", message: "M", frame_template: null, page_url: null, status: "new", created_at: "2026-10-01", user_id: "u1" },
            ],
          }
        : FAIL;
    const inbox = await listAllFeedback("all");
    expect(inbox?.loadError).toBe(true);
    expect(inbox?.items).toHaveLength(1);
  });

  it("a clean read is not flagged", async () => {
    expect(await listAllFeedback("all")).toEqual({ items: [], loadError: false });
    expect(log).not.toHaveBeenCalled();
  });

  it("flags a failed thread-link read", async () => {
    state.resolve = () => FAIL;
    const links = await threadIdsForFeedback(["f1"]);
    expect(links.loadError).toBe(true);
    expect(links.threads.size).toBe(0);
  });
});

describe("conversations", () => {
  it("flags and logs a failed thread list (the inbox and a user's detail)", async () => {
    state.resolve = (table) => (table === "message_threads" ? FAIL : { data: [] });
    expect(await listAllThreads("all")).toEqual({ threads: [], loadError: true });
    expect(await listThreadsForUser("u1")).toEqual({ threads: [], loadError: true });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("thread list read failed"), "boom");
  });

  it("a clean read is not flagged", async () => {
    expect(await listAllThreads("unread")).toEqual({ threads: [], loadError: false });
  });
});

const CARD = {
  id: "c1",
  title: "Gravebloom Shade",
  slug: "gravebloom-shade",
  owner_id: "o1",
  rendered_image_url: "https://x.supabase.co/storage/v1/object/public/card-renders/o1/c1.png",
  rendered_thumb_url: "https://x.supabase.co/storage/v1/object/public/card-renders/o1/c1.thumb.webp",
};

describe("moderation queue", () => {
  it("flags and logs a failed report read on both queues", async () => {
    state.resolve = () => FAIL;
    expect(await getModerationQueue()).toEqual({ items: [], loadError: true });
    expect(await getCommentModerationQueue()).toEqual({ items: [], loadError: true });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("card report read failed"), "boom");
  });

  it("each reported card carries its whole row (the thumb tile) and a link to its page (L6)", async () => {
    state.resolve = (table) =>
      table === "card_reports"
        ? {
            data: [
              { id: "r1", reason: "spam", details: null, created_at: "2026-10-02", card_id: "c1", cards: CARD },
              { id: "r2", reason: "other", details: "x", created_at: "2026-10-01", card_id: "c1", cards: CARD },
            ],
          }
        : { data: [{ id: "o1", username: "maker" }] };
    const queue = await getModerationQueue();
    expect(queue?.loadError).toBe(false);
    expect(queue?.items).toHaveLength(1);
    const [item] = queue!.items;
    expect(item.href).toBe("/card/maker/gravebloom-shade");
    expect(item.card.rendered_thumb_url).toBe(CARD.rendered_thumb_url);
    expect(item.reports.map((r) => r.id)).toEqual(["r1", "r2"]);
  });

  it("an owner read that fails keeps the cards, drops the links, and is flagged", async () => {
    state.resolve = (table) =>
      table === "card_reports"
        ? { data: [{ id: "r1", reason: "spam", details: null, created_at: "2026-10-02", card_id: "c1", cards: CARD }] }
        : FAIL;
    const queue = await getModerationQueue();
    expect(queue?.loadError).toBe(true);
    expect(queue?.items[0].href).toBeNull();
  });
});

describe("users directory", () => {
  const row = (total: number) => ({
    id: "u1",
    username: "dev_pro",
    display_name: null,
    avatar_url: null,
    email: "pro@dev.pipglyph.test",
    subscription_tier: "pro",
    subscription_status: "active",
    comp_tier: null,
    comp_expires_at: null,
    credits: 1,
    is_admin: false,
    card_count: 0,
    deck_count: 0,
    created_at: "2026-07-01",
    last_active_at: null,
    total_count: total,
  });

  it("flags and logs a failed read — never '0 total' / 'No users match' as the truth", async () => {
    state.rpc = () => FAIL;
    const page = await listAdminUsers(parseUserListParams({}));
    expect(page).toMatchObject({ rows: [], loadError: true, pastEnd: false });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("admin_list_users failed"), "boom");
  });

  it("past the last page reads the real total and says pastEnd (L8)", async () => {
    const offsets: unknown[] = [];
    state.rpc = (_name, args) => {
      offsets.push(args.p_offset);
      return { data: args.p_offset === 0 ? [row(42)] : [] };
    };
    const page = await listAdminUsers(parseUserListParams({ page: "9" }));
    expect(page).toMatchObject({ rows: [], total: 42, page: 9, pastEnd: true, loadError: false });
    expect(offsets).toEqual([8 * page!.pageSize, 0]);
  });

  it("page 1 with no match is a plain empty page (no second read)", async () => {
    let calls = 0;
    state.rpc = () => {
      calls += 1;
      return { data: [] };
    };
    const page = await listAdminUsers(parseUserListParams({ q: "nobody" }));
    expect(page).toMatchObject({ rows: [], total: 0, pastEnd: false, loadError: false });
    expect(calls).toBe(1);
  });
});
