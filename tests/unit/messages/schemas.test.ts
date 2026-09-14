import { describe, expect, it } from "vitest";
import {
  MESSAGE_BODY_MAX,
  MESSAGE_SUBJECT_MAX,
  messageBodySchema,
  replyToFeedbackSchema,
  sendMessageSchema,
  startThreadSchema,
  threadSubjectSchema,
} from "@/lib/messages/schemas";

const UUID = "11111111-2222-4333-8444-555555555555";

describe("messaging schemas mirror migration 0070's CHECK constraints", () => {
  it("body: 1–4000 chars after trimming", () => {
    expect(messageBodySchema.safeParse("  hello  ").data).toBe("hello");
    expect(messageBodySchema.safeParse("   ").success).toBe(false);
    expect(messageBodySchema.safeParse("x".repeat(MESSAGE_BODY_MAX)).success).toBe(true);
    expect(messageBodySchema.safeParse("x".repeat(MESSAGE_BODY_MAX + 1)).success).toBe(false);
  });

  it("subject: 1–120 chars after trimming", () => {
    expect(threadSubjectSchema.safeParse(" Re: export ").data).toBe("Re: export");
    expect(threadSubjectSchema.safeParse("").success).toBe(false);
    expect(threadSubjectSchema.safeParse("s".repeat(MESSAGE_SUBJECT_MAX + 1)).success).toBe(false);
  });

  it("composite inputs validate ids as uuids", () => {
    expect(sendMessageSchema.safeParse({ threadId: UUID, body: "hi" }).success).toBe(true);
    expect(sendMessageSchema.safeParse({ threadId: "nope", body: "hi" }).success).toBe(false);
    expect(
      startThreadSchema.safeParse({ userId: UUID, subject: "Hello", body: "there" }).success,
    ).toBe(true);
    expect(startThreadSchema.safeParse({ userId: UUID, subject: "", body: "there" }).success).toBe(false);
    expect(replyToFeedbackSchema.safeParse({ feedbackId: UUID, body: "ok" }).success).toBe(true);
    expect(replyToFeedbackSchema.safeParse({ feedbackId: UUID, body: "" }).success).toBe(false);
  });
});
