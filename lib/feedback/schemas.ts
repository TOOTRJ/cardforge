import { z } from "zod";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// User feedback intake. Category-first (routes the submission and sets the
// right optional context field), one required subject + message, everything
// else optional — low-friction by design.
// ---------------------------------------------------------------------------

export const FEEDBACK_CATEGORIES = [
  {
    key: "bug",
    label: "Bug report",
    hint: "Something's broken or behaving unexpectedly.",
  },
  {
    key: "frame",
    label: "Frame or layout issue",
    hint: "A frame renders wrong — misaligned text, bad colors, missing pieces.",
  },
  {
    key: "feature",
    label: "Feature request",
    hint: "Something you wish PipGlyph could do.",
  },
  {
    key: "frame_request",
    label: "New frame request",
    hint: "A card frame or treatment you'd like us to add.",
  },
  {
    key: "other",
    label: "Something else",
    hint: "Anything that doesn't fit the buckets above.",
  },
] as const;

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number]["key"];

export const FEEDBACK_CATEGORY_KEYS = FEEDBACK_CATEGORIES.map((c) => c.key);

export const FEEDBACK_STATUSES = ["new", "reviewed", "resolved"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const feedbackSchema = z.object({
  category: z.enum(
    FEEDBACK_CATEGORY_KEYS as [FeedbackCategory, ...FeedbackCategory[]],
  ),
  subject: z
    .string()
    .trim()
    .min(1, "Give your feedback a short subject.")
    .max(120, "Subject must be 120 characters or fewer."),
  message: z
    .string()
    .trim()
    .min(1, "Tell us what happened (or what you'd like).")
    .max(2000, "Message must be 2000 characters or fewer."),
  // Optional frame context — validated against real templates so the admin
  // inbox can deep-link to the frame-compare tool.
  frame_template: z
    .enum(FRAME_TEMPLATE_VALUES as unknown as [string, ...string[]])
    .optional()
    .or(z.literal("").transform(() => undefined)),
  page_url: z
    .string()
    .trim()
    .max(512)
    .regex(/^\/[^\s]*$/, "Invalid page path.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export type FeedbackInput = z.infer<typeof feedbackSchema>;
