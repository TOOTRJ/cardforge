// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";

// ---------------------------------------------------------------------------
// An admin answers a feedback submission IN THE CONVERSATION (owner
// 2026-11-11: "I now want the conversation to just open up rather than
// having a modal open up"): the inbox's Reply is a link, the page it opens
// shows the user's whole message with the reply box under it, and the first
// reply makes the thread and moves on to it.
// ---------------------------------------------------------------------------

const FEEDBACK = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const THREAD = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const nav = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  redirected: null as string | null,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: nav.push, refresh: nav.refresh }),
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (to: string) => {
    nav.redirected = to;
    throw new Error("REDIRECT");
  },
}));
const actions = vi.hoisted(() => ({ reply: vi.fn(), send: vi.fn(), userSend: vi.fn() }));
vi.mock("@/lib/messages/actions", () => ({
  adminReplyToFeedbackAction: actions.reply,
  adminSendMessageAction: actions.send,
  sendMessageAction: actions.userSend,
}));
const reads = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock("@/lib/messages/queries", () => ({ getFeedbackConversationStart: reads.start }));

import { FeedbackReplyButton, feedbackConversationHref } from "@/components/admin/feedback-reply-button";
import { ReplyForm } from "@/components/messages/reply-form";
import AdminFeedbackConversationPage from "@/app/(app)/admin/messages/feedback/[feedbackId]/page";

const start = (over: Record<string, unknown> = {}) => ({
  feedback: { id: FEEDBACK, category: "bug", subject: "Broken frame", message: "The crown is cut off.\nSecond line of the report.", createdAt: "2026-11-10T10:00:00Z", status: "new" },
  user: { id: USER, username: "ember_sphinx", displayName: "Ember" },
  threadId: null,
  ...over,
});

beforeEach(() => {
  nav.replace.mockClear();
  nav.push.mockClear();
  nav.refresh.mockClear();
  nav.redirected = null;
  toast.success.mockClear();
  toast.error.mockClear();
  actions.reply.mockReset().mockResolvedValue({ ok: true, threadId: THREAD });
  actions.send.mockReset().mockResolvedValue({ ok: true });
  actions.userSend.mockReset().mockResolvedValue({ ok: true });
  reads.start.mockReset().mockResolvedValue(start());
});
afterEach(cleanup);

describe("the inbox's Reply button", () => {
  it("is a link to the conversation — no dialog, no client state", () => {
    const out = renderToStaticMarkup(<FeedbackReplyButton feedbackId={FEEDBACK} existingThreadId={null} />);
    expect(out).toContain(`href="/admin/messages/feedback/${FEEDBACK}"`);
    expect(out).toContain("Reply");
    expect(out).not.toMatch(/dialog|aria-haspopup|<textarea/i);
    expect(feedbackConversationHref(FEEDBACK)).toBe(`/admin/messages/feedback/${FEEDBACK}`);
    const source = readFileSync(join(process.cwd(), "components/admin/feedback-reply-button.tsx"), "utf8");
    expect(source).not.toMatch(/^"use client"/m);
    expect(source).not.toMatch(/@\/components\/ui\/dialog/);
  });

  it("goes to the thread a submission already has", () => {
    const out = renderToStaticMarkup(<FeedbackReplyButton feedbackId={FEEDBACK} existingThreadId={THREAD} />);
    expect(out).toContain(`href="/admin/messages/${THREAD}"`);
    expect(out).toContain("Open conversation");
    expect(out).not.toContain("/admin/messages/feedback/");
  });

  it("is a disabled button, with the reason, when nobody is left to reply to", () => {
    const out = renderToStaticMarkup(
      <FeedbackReplyButton feedbackId={FEEDBACK} existingThreadId={null} disabledReason="The sender's account was deleted." />,
    );
    expect(out).toMatch(/<button[^>]*disabled/);
    expect(out).toContain("The sender&#x27;s account was deleted.");
    expect(out).not.toContain("href=");
  });
});

describe("the conversation page before the first reply", () => {
  const page = async () => renderToStaticMarkup(await AdminFeedbackConversationPage({ params: Promise.resolve({ feedbackId: FEEDBACK }) }));

  it("shows the user's whole message with the reply box under it", async () => {
    const out = await page();
    expect(out).toContain("Re: Broken frame");
    expect(out).toContain("The crown is cut off.\nSecond line of the report.");
    expect(out).toContain("Their feedback");
    expect(out).toContain("No reply yet");
    expect(out.indexOf("Second line of the report.")).toBeLessThan(out.indexOf("<textarea"));
    expect(out).toContain(`id="reply-${FEEDBACK}"`);
    expect(out).toContain("Your reply starts the conversation");
    expect(out).not.toMatch(/role="dialog"/);
  });

  it("names who it is with, linked to their admin page and profile, and the way back to the inbox", async () => {
    const out = await page();
    expect(out).toContain(`href="/admin/users?u=${USER}"`);
    expect(out).toContain(">Ember<");
    expect(out).toContain('href="/profile/ember_sphinx"');
    expect(out).toContain('href="/admin/feedback"');
  });

  it("draws no empty message list", async () => {
    expect(await page()).not.toContain('aria-label="Messages"');
  });

  it("a submission that already has a conversation goes straight to it", async () => {
    reads.start.mockResolvedValue(start({ threadId: THREAD }));
    await expect(page()).rejects.toThrow("REDIRECT");
    expect(nav.redirected).toBe(`/admin/messages/${THREAD}`);
  });

  it("is a 404 for an unknown submission, a non-admin (the read's null) and an id that is not one", async () => {
    reads.start.mockResolvedValue(null);
    await expect(page()).rejects.toThrow("NOT_FOUND");
    reads.start.mockClear();
    await expect(AdminFeedbackConversationPage({ params: Promise.resolve({ feedbackId: "not-an-id" }) })).rejects.toThrow("NOT_FOUND");
    expect(reads.start).not.toHaveBeenCalled();
  });

  it("a sender whose account is gone: the message still shows, with no reply box", async () => {
    reads.start.mockResolvedValue(start({ user: null }));
    const out = await page();
    expect(out).toContain("The crown is cut off.");
    expect(out).toContain("Deleted account");
    expect(out).toContain("nobody to reply to");
    expect(out).not.toContain("<textarea");
  });
});

describe("the first reply", () => {
  const type = (text: string) => fireEvent.change(screen.getByLabelText("Reply"), { target: { value: text } });

  it("opens the thread through the feedback action and moves on to it", async () => {
    render(<ReplyForm feedbackId={FEEDBACK} side="admin" />);
    type("Thanks — fixed in the next release.");
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith(`/admin/messages/${THREAD}`));
    expect(actions.reply).toHaveBeenCalledWith({ feedbackId: FEEDBACK, body: "Thanks — fixed in the next release." });
    expect(actions.send).not.toHaveBeenCalled();
    expect(nav.refresh).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("Reply sent — the user has been notified.");
  });

  it("stays on the page with the reason, and keeps what was typed, when the reply is refused", async () => {
    actions.reply.mockResolvedValue({ ok: false, error: "The account that sent this feedback was deleted." });
    render(<ReplyForm feedbackId={FEEDBACK} side="admin" />);
    type("Hello");
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("The account that sent this feedback was deleted."));
    expect(nav.replace).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Reply") as HTMLTextAreaElement).value).toBe("Hello");
    expect(screen.getByText("The account that sent this feedback was deleted.")).toBeTruthy();
  });

  it("an empty reply sends nothing", () => {
    render(<ReplyForm feedbackId={FEEDBACK} side="admin" />);
    expect((screen.getByRole("button", { name: /send/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(actions.reply).not.toHaveBeenCalled();
  });
});

describe("a reply in a thread that exists is unchanged", () => {
  it("an admin's goes through the thread action and refreshes in place", async () => {
    render(<ReplyForm threadId={THREAD} side="admin" />);
    fireEvent.change(screen.getByLabelText("Reply"), { target: { value: "More detail" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect(nav.refresh).toHaveBeenCalled());
    expect(actions.send).toHaveBeenCalledWith({ threadId: THREAD, body: "More detail" });
    expect(actions.reply).not.toHaveBeenCalled();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("a user's goes through the user's action", async () => {
    render(<ReplyForm threadId={THREAD} side="user" />);
    fireEvent.change(screen.getByLabelText("Reply"), { target: { value: "Thanks" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect(actions.userSend).toHaveBeenCalledWith({ threadId: THREAD, body: "Thanks" }));
    expect(actions.send).not.toHaveBeenCalled();
    expect(actions.reply).not.toHaveBeenCalled();
  });
});
