import { beforeEach, describe, expect, it, vi } from "vitest";
import { called, chainClient, type ChainCall } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// getFeedbackConversationStart — a feedback row as the conversation it is
// about to become (owner 2026-11-11: the inbox's Reply opens the
// conversation, no dialog). It is a READ: looking at the page makes no
// thread (the user must never find an empty conversation — audit L7); the
// first reply does. Admins only.
// ---------------------------------------------------------------------------

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FEEDBACK = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const THREAD = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const state = vi.hoisted(() => ({
  stub: null as null | ReturnType<typeof import("@/tests/stubs/supabase-chain").chainClient>,
  isAdmin: true,
  clients: 0,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentProfile: async () => ({ id: ADMIN, is_admin: state.isAdmin }),
  getCurrentUser: async () => ({ id: ADMIN }),
  createClient: async () => {
    throw new Error("an admin read goes through the admin client");
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => true,
  createAdminClient: () => {
    state.clients += 1;
    return state.stub!.client;
  },
}));

import { getFeedbackConversationStart } from "@/lib/messages/queries";

let feedback: Record<string, unknown> | null;
let thread: { id: string } | null;
let profiles: Array<Record<string, unknown>>;

const writes = (calls: ChainCall[]) => ["insert", "update", "upsert", "delete"].some((m) => called(calls, m));

beforeEach(() => {
  state.isAdmin = true;
  state.clients = 0;
  feedback = { id: FEEDBACK, user_id: USER, category: "bug", subject: "Broken frame", message: "Line one\nLine two", created_at: "2026-11-10T10:00:00Z", status: "new" };
  thread = null;
  profiles = [{ id: USER, username: "ember_sphinx", display_name: "Ember", avatar_url: null }];
  state.stub = chainClient((table) => {
    if (table === "feedback") return { data: feedback };
    if (table === "message_threads") return { data: thread };
    if (table === "profiles") return { data: profiles };
    return {};
  });
});

describe("getFeedbackConversationStart", () => {
  it("hands back the whole message, who sent it, and no thread before the first reply", async () => {
    expect(await getFeedbackConversationStart(FEEDBACK)).toEqual({
      feedback: { id: FEEDBACK, category: "bug", subject: "Broken frame", message: "Line one\nLine two", createdAt: "2026-11-10T10:00:00Z", status: "new" },
      user: { id: USER, username: "ember_sphinx", displayName: "Ember" },
      threadId: null,
    });
  });

  it("only reads: no thread, message or status is written by opening the page", async () => {
    await getFeedbackConversationStart(FEEDBACK);
    expect(state.stub!.log.length).toBeGreaterThan(0);
    for (const entry of state.stub!.log) expect(writes(entry.calls), entry.table).toBe(false);
  });

  it("looks the thread up by THIS feedback row", async () => {
    await getFeedbackConversationStart(FEEDBACK);
    const [lookup] = state.stub!.forTable("message_threads");
    expect(lookup.calls.some((c) => c.method === "eq" && c.args[0] === "feedback_id" && c.args[1] === FEEDBACK)).toBe(true);
  });

  it("names the conversation a submission already has", async () => {
    thread = { id: THREAD };
    expect((await getFeedbackConversationStart(FEEDBACK))?.threadId).toBe(THREAD);
  });

  it("a sender whose account is gone: no user, and no profile is asked for", async () => {
    feedback = { ...feedback!, user_id: null };
    const start = await getFeedbackConversationStart(FEEDBACK);
    expect(start?.user).toBeNull();
    expect(start?.feedback.message).toBe("Line one\nLine two");
    expect(state.stub!.forTable("profiles")).toHaveLength(0);
  });

  it("a sender with no readable profile keeps their id", async () => {
    profiles = [];
    expect((await getFeedbackConversationStart(FEEDBACK))?.user).toEqual({ id: USER, username: null, displayName: null });
  });

  it("is null for a feedback id that does not exist", async () => {
    feedback = null;
    expect(await getFeedbackConversationStart(FEEDBACK)).toBeNull();
  });

  it("is null for anyone but an admin, and the service client is never built", async () => {
    state.isAdmin = false;
    expect(await getFeedbackConversationStart(FEEDBACK)).toBeNull();
    expect(state.clients).toBe(0);
  });
});
