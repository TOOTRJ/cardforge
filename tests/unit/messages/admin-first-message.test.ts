import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { called, chainClient, type ChainCall } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// Audit L7: an admin's FIRST message in a conversation the action itself
// opened fails → the thread goes again, so neither the user's Messages nor
// the team inbox shows an empty conversation. A thread that already existed
// (a feedback reply on its own thread) is never removed.
// ---------------------------------------------------------------------------

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FEEDBACK = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const THREAD = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const state = vi.hoisted(() => ({
  stub: null as null | ReturnType<typeof import("@/tests/stubs/supabase-chain").chainClient>,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentProfile: async () => ({ id: ADMIN, is_admin: true }),
  getCurrentUser: async () => ({ id: ADMIN }),
  createClient: async () => {
    throw new Error("not in this test");
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => true,
  createAdminClient: () => state.stub!.client,
}));
const email = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/messages/notify", () => ({ emailUserAboutMessage: email }));

import { adminReplyToFeedbackAction, adminStartThreadAction } from "@/lib/messages/actions";

const isInsert = (calls: ChainCall[]) => called(calls, "insert");
const isDelete = (calls: ChainCall[]) => called(calls, "delete");

let messageInsertFails = true;
let existingThread: unknown = null;
let log: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  messageInsertFails = true;
  existingThread = null;
  email.mockClear();
  log = vi.spyOn(console, "warn").mockImplementation(() => {});
  state.stub = chainClient((table, calls) => {
    if (table === "profiles") return { data: { id: USER } };
    if (table === "feedback") return { data: { id: FEEDBACK, user_id: USER, subject: "Broken frame", status: "new" } };
    if (table === "messages") return messageInsertFails ? { error: { message: "insert refused" } } : {};
    if (table === "message_threads") {
      if (isInsert(calls)) return { data: { id: THREAD, user_id: USER, subject: "Hello" } };
      if (isDelete(calls)) return {};
      if (called(calls, "maybeSingle")) return { data: existingThread };
      return {};
    }
    return {};
  });
});
afterEach(() => log.mockRestore());

const threadDeletes = () =>
  state.stub!.forTable("message_threads").filter((e) => isDelete(e.calls));

describe("adminStartThreadAction", () => {
  it("removes the thread it opened when the first message fails", async () => {
    const result = await adminStartThreadAction({ userId: USER, subject: "Hello", body: "Hi there" });
    expect(result).toEqual({ ok: false, error: "Couldn't send the message." });
    const deletes = threadDeletes();
    expect(deletes).toHaveLength(1);
    expect(deletes[0].calls.find((c) => c.method === "eq")?.args).toEqual(["id", THREAD]);
    expect(email).not.toHaveBeenCalled();
  });

  it("keeps the thread when the message goes out", async () => {
    messageInsertFails = false;
    expect(await adminStartThreadAction({ userId: USER, subject: "Hello", body: "Hi there" })).toEqual({
      ok: true,
      threadId: THREAD,
    });
    expect(threadDeletes()).toHaveLength(0);
  });
});

describe("adminReplyToFeedbackAction", () => {
  it("removes a thread opened for the reply when the reply fails", async () => {
    const result = await adminReplyToFeedbackAction({ feedbackId: FEEDBACK, body: "Thanks!" });
    expect(result.ok).toBe(false);
    expect(threadDeletes()).toHaveLength(1);
  });

  it("never removes the feedback's EXISTING thread", async () => {
    existingThread = { id: THREAD, user_id: USER, subject: "Re: Broken frame" };
    const result = await adminReplyToFeedbackAction({ feedbackId: FEEDBACK, body: "Thanks!" });
    expect(result.ok).toBe(false);
    expect(threadDeletes()).toHaveLength(0);
  });
});
