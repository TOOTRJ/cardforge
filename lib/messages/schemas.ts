import { z } from "zod";

// ---------------------------------------------------------------------------
// Admin ↔ user messaging — shared client + server validation. Limits mirror
// the CHECK constraints in migration 0070 exactly (subject 1–120, body
// 1–4000) so a value the form accepts can never bounce off the database.
// ---------------------------------------------------------------------------

export const MESSAGE_BODY_MAX = 4000;
export const MESSAGE_SUBJECT_MAX = 120;

/** A real person doesn't post more than this in an hour; the server action
 *  refuses the rest (RLS still allows the insert — this is spam hygiene,
 *  not security). */
export const USER_MESSAGES_PER_HOUR = 30;

export const messageBodySchema = z
  .string()
  .trim()
  .min(1, "Write a message first.")
  .max(MESSAGE_BODY_MAX, `Messages must be ${MESSAGE_BODY_MAX} characters or fewer.`);

export const threadSubjectSchema = z
  .string()
  .trim()
  .min(1, "Give the conversation a subject.")
  .max(MESSAGE_SUBJECT_MAX, `Subjects must be ${MESSAGE_SUBJECT_MAX} characters or fewer.`);

export const sendMessageSchema = z.object({
  threadId: z.string().uuid("Invalid thread."),
  body: messageBodySchema,
});

export const startThreadSchema = z.object({
  userId: z.string().uuid("Invalid user id."),
  subject: threadSubjectSchema,
  body: messageBodySchema,
});

export const replyToFeedbackSchema = z.object({
  feedbackId: z.string().uuid("Invalid feedback id."),
  body: messageBodySchema,
});

export const THREAD_STATUSES = ["open", "closed"] as const;
export type ThreadStatus = (typeof THREAD_STATUSES)[number];

export const MESSAGE_SENDER_ROLES = ["user", "admin"] as const;
export type MessageSenderRole = (typeof MESSAGE_SENDER_ROLES)[number];

/** How the team is named in a user's inbox. Admin usernames are never shown
 *  to users — every admin post reads as the team. */
export const TEAM_DISPLAY_NAME = "PipGlyph team";
