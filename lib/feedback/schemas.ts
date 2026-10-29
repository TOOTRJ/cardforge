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

// ---------------------------------------------------------------------------
// Areas (migration 0146, TODO DK10.1): WHERE a submission was sent from, so
// the admin inbox can filter it. NULL = the general /feedback page. A new
// area is one more entry here AND one more value in 0146's
// `feedback_area_check` (a unit test holds the two lists together).
// ---------------------------------------------------------------------------

export const FEEDBACK_AREAS = [{ key: "decks", label: "Decks" }] as const;

export type FeedbackArea = (typeof FEEDBACK_AREAS)[number]["key"];

export const FEEDBACK_AREA_KEYS = FEEDBACK_AREAS.map((a) => a.key);

export function isFeedbackArea(value: unknown): value is FeedbackArea {
  return (FEEDBACK_AREA_KEYS as readonly unknown[]).includes(value);
}

// ---------------------------------------------------------------------------
// The deck feedback dialog (TODO DK10.1): three kinds and a message — no
// subject to write. Each kind files under an existing category, so the
// inbox's tones and the sender's history read it as they read /feedback.
// The dialog attaches the deck, the page's PATH and the window size itself.
// ---------------------------------------------------------------------------

export const DECK_FEEDBACK_KINDS = [
  {
    key: "idea",
    label: "Idea",
    category: "feature",
    hint: "Something the deck builder should do, or do better.",
  },
  {
    key: "bug",
    label: "Bug",
    category: "bug",
    hint: "Something's broken, missing or looks wrong.",
  },
  {
    key: "other",
    label: "Other",
    category: "other",
    hint: "Anything else about decks.",
  },
] as const satisfies readonly {
  key: string;
  label: string;
  category: FeedbackCategory;
  hint: string;
}[];

export type DeckFeedbackKind = (typeof DECK_FEEDBACK_KINDS)[number]["key"];

const DECK_FEEDBACK_KIND_KEYS = DECK_FEEDBACK_KINDS.map((k) => k.key);

export function deckFeedbackCategory(kind: DeckFeedbackKind): FeedbackCategory {
  return DECK_FEEDBACK_KINDS.find((k) => k.key === kind)?.category ?? "other";
}

/** The window size, as 0146's `feedback_viewport_shape` stores it. */
export const VIEWPORT_PATTERN = /^[0-9]{1,5}x[0-9]{1,5}$/;

export function viewportOf(width: number, height: number): string | undefined {
  const w = Math.round(width);
  const h = Math.round(height);
  const value = `${w}x${h}`;
  return w >= 0 && h >= 0 && VIEWPORT_PATTERN.test(value) ? value : undefined;
}

/** The inbox's subject for a dialog submission (the table requires one, the
 *  dialog asks for none): the message's first line, cut at a word. */
export const DECK_FEEDBACK_SUBJECT_MAX = 80;

export function deckFeedbackSubject(message: string): string {
  const firstLine = message.trim().split(/\r?\n/)[0]?.trim() ?? "";
  if (firstLine.length <= DECK_FEEDBACK_SUBJECT_MAX) return firstLine || "Deck feedback";
  const cut = firstLine.slice(0, DECK_FEEDBACK_SUBJECT_MAX - 1);
  const atWord = cut.lastIndexOf(" ");
  return `${(atWord > 40 ? cut.slice(0, atWord) : cut).trimEnd()}…`;
}

export const deckFeedbackSchema = z.object({
  kind: z.enum(DECK_FEEDBACK_KIND_KEYS as [DeckFeedbackKind, ...DeckFeedbackKind[]], {
    error: "Pick Idea, Bug or Other.",
  }),
  message: feedbackSchema.shape.message,
  deck_id: z
    .string()
    .uuid("Invalid deck.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  // The PATH alone: a query string or a hash can carry someone's search
  // or a token, so neither is ever sent.
  page_url: z
    .string()
    .trim()
    .max(512)
    .regex(/^\/[^\s?#]*$/, "Invalid page path.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  viewport: z
    .string()
    .regex(VIEWPORT_PATTERN, "Invalid screen size.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export type DeckFeedbackInput = z.input<typeof deckFeedbackSchema>;
