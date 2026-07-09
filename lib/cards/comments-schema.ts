import { z } from "zod";

// Client-safe comment validation, shared by the composer (inline errors
// before a round trip) and the server actions (the authority). Kept out of
// the "use server" actions file, which may only export async functions.

export const COMMENT_MAX_LENGTH = 2000;

export const commentBodySchema = z
  .string()
  .trim()
  .min(1, "Comment can't be empty.")
  .max(
    COMMENT_MAX_LENGTH,
    `Comment must be ${COMMENT_MAX_LENGTH} characters or fewer.`,
  );
