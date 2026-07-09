import { z } from "zod";
import { REPORT_REASONS } from "@/lib/moderation/reasons";

// Client-safe report validation, shared by the report dialog (inline errors
// before a round trip) and the server actions (the authority). Kept out of
// the "use server" actions file, which may only export async functions.

export const REPORT_DETAILS_MAX_LENGTH = 1000;

export const reportReasonSchema = z.enum(REPORT_REASONS, {
  message: "Pick a reason for the report.",
});

export const reportDetailsSchema = z
  .string()
  .trim()
  .max(
    REPORT_DETAILS_MAX_LENGTH,
    `Keep details under ${REPORT_DETAILS_MAX_LENGTH} characters.`,
  )
  .optional()
  .or(z.literal("").transform(() => undefined));
