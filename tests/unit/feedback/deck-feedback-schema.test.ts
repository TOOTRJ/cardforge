import { describe, expect, it } from "vitest";
import {
  DECK_FEEDBACK_KINDS,
  DECK_FEEDBACK_SUBJECT_MAX,
  deckFeedbackCategory,
  deckFeedbackSchema,
  deckFeedbackSubject,
  feedbackSchema,
  isFeedbackArea,
  viewportOf,
} from "@/lib/feedback/schemas";
import { feedbackInboxHref, parseFeedbackInboxParams } from "@/lib/feedback/inbox-filters";
import { DECK_BETA_BANNER_ENDS_AT, deckBetaBannerLive } from "@/lib/decks/beta-banner";

// ---------------------------------------------------------------------------
// The deck feedback dialog's schema and the feedback area (TODO DK10.1), the
// admin inbox's filter URLs, and the beta banner's end date (DK10.2). The
// SQL side is tests/unit/db/feedback-area-migration.test.ts.
// ---------------------------------------------------------------------------

const DECK = "b0000000-0000-4000-a000-000000000001";
const valid = {
  kind: "idea",
  message: "Sort the list by colour, please.",
  deck_id: DECK,
  page_url: "/deck/cinderwing-dragonstorm",
  viewport: "390x844",
};

describe("areas and window sizes", () => {
  it("viewportOf writes what the CHECK takes", () => {
    expect(viewportOf(390, 844)).toBe("390x844");
    expect(viewportOf(1366.4, 767.6)).toBe("1366x768");
    expect(viewportOf(123456, 1)).toBeUndefined();
    expect(viewportOf(Number.NaN, 1)).toBeUndefined();
  });

  it("isFeedbackArea knows only the listed areas", () => {
    expect(isFeedbackArea("decks")).toBe(true);
    expect(isFeedbackArea("cards")).toBe(false);
    expect(isFeedbackArea(null)).toBe(false);
  });
});

describe("deck feedback kinds", () => {
  it("are Idea / Bug / Other, filed as a feature request, a bug and other", () => {
    expect(DECK_FEEDBACK_KINDS.map((k) => k.label)).toEqual(["Idea", "Bug", "Other"]);
    expect(deckFeedbackCategory("idea")).toBe("feature");
    expect(deckFeedbackCategory("bug")).toBe("bug");
    expect(deckFeedbackCategory("other")).toBe("other");
  });
});

describe("deckFeedbackSchema", () => {
  it("accepts the dialog's payload", () => {
    expect(deckFeedbackSchema.parse(valid)).toEqual(valid);
  });

  it("treats a blank deck, page or viewport as none (My Decks has no deck)", () => {
    const parsed = deckFeedbackSchema.parse({ ...valid, deck_id: "", page_url: "", viewport: "" });
    expect(parsed.deck_id).toBeUndefined();
    expect(parsed.page_url).toBeUndefined();
    expect(parsed.viewport).toBeUndefined();
  });

  it("takes the page's PATH only — never a query string or a hash", () => {
    for (const page_url of ["/deck/x?email=a@b.c", "/deck/x#token", "https://pipglyph.com/deck/x", "deck/x", "/deck x"]) {
      expect(deckFeedbackSchema.safeParse({ ...valid, page_url }).success, page_url).toBe(false);
    }
  });

  it("refuses an unknown kind, a bad deck id, a bad viewport and an empty message", () => {
    expect(deckFeedbackSchema.safeParse({ ...valid, kind: "feature" }).success).toBe(false);
    expect(deckFeedbackSchema.safeParse({ ...valid, deck_id: "not-a-uuid" }).success).toBe(false);
    expect(deckFeedbackSchema.safeParse({ ...valid, viewport: "390 x 844" }).success).toBe(false);
    const empty = deckFeedbackSchema.safeParse({ ...valid, message: "   " });
    expect(empty.success).toBe(false);
    expect(empty.error?.issues[0]?.path).toEqual(["message"]);
  });

  it("shares /feedback's message limits", () => {
    expect(deckFeedbackSchema.shape.message).toBe(feedbackSchema.shape.message);
    expect(deckFeedbackSchema.safeParse({ ...valid, message: "x".repeat(2001) }).success).toBe(false);
  });
});

describe("deckFeedbackSubject", () => {
  it("is the message's first line", () => {
    expect(deckFeedbackSubject("  Steppers jump\nwhen I click fast")).toBe("Steppers jump");
  });

  it("cuts a long first line at a word, inside the subject limit", () => {
    const long = "The deck page should let me sort every board by mana value and then by name, like the gallery does";
    const subject = deckFeedbackSubject(long);
    expect(subject.length).toBeLessThanOrEqual(DECK_FEEDBACK_SUBJECT_MAX);
    expect(subject.endsWith("…")).toBe(true);
    expect(long.startsWith(subject.slice(0, -1))).toBe(true);
    expect(subject.slice(0, -1).endsWith(" ")).toBe(false);
    // /feedback's own subject rule takes it.
    expect(feedbackSchema.shape.subject.safeParse(subject).success).toBe(true);
  });

  it("cuts a long word too", () => {
    expect(deckFeedbackSubject("x".repeat(300))).toHaveLength(DECK_FEEDBACK_SUBJECT_MAX);
  });

  it("never cuts through an emoji (a lone surrogate fails the send on every retry)", () => {
    for (const line of [
      "😀".repeat(100),
      `${"x".repeat(78)}😀😀😀`,
      `${"x".repeat(77)}👩‍👩‍👧 and more words after it`,
      `Deck page ${"🃏".repeat(60)}`,
    ]) {
      const subject = deckFeedbackSubject(line);
      expect(subject.isWellFormed(), line).toBe(true);
      expect(subject.length, line).toBeLessThanOrEqual(DECK_FEEDBACK_SUBJECT_MAX);
      expect(subject.endsWith("…"), line).toBe(true);
      expect(line.startsWith(subject.slice(0, -1)), line).toBe(true);
      expect(feedbackSchema.shape.subject.safeParse(subject).success, line).toBe(true);
    }
    // 100 emoji: 39 whole ones (78 units) and the ellipsis.
    expect(deckFeedbackSubject("😀".repeat(100))).toBe(`${"😀".repeat(39)}…`);
  });
});

describe("the admin inbox's filters", () => {
  it("reads status and area from the URL, defaulting to unresolved and every area", () => {
    expect(parseFeedbackInboxParams({})).toEqual({ filter: "unresolved", area: null });
    expect(parseFeedbackInboxParams({ status: "all", area: "decks" })).toEqual({ filter: "all", area: "decks" });
    expect(parseFeedbackInboxParams({ status: "resolved", area: "nope" })).toEqual({ filter: "resolved", area: null });
    expect(parseFeedbackInboxParams({ status: "bogus" })).toEqual({ filter: "unresolved", area: null });
  });

  it("each row's links keep the other row's choice", () => {
    expect(feedbackInboxHref("unresolved", null)).toBe("/admin/feedback");
    expect(feedbackInboxHref("unresolved", "decks")).toBe("/admin/feedback?area=decks");
    expect(feedbackInboxHref("new", "decks")).toBe("/admin/feedback?status=new&area=decks");
    expect(feedbackInboxHref("all", null)).toBe("/admin/feedback?status=all");
  });
});

describe("the beta banner's end date (DK10.2)", () => {
  it("shows until the end date, then never", () => {
    const end = Date.parse(DECK_BETA_BANNER_ENDS_AT);
    expect(Number.isFinite(end)).toBe(true);
    expect(deckBetaBannerLive(end - 1)).toBe(true);
    expect(deckBetaBannerLive(end)).toBe(false);
    expect(deckBetaBannerLive(end + 86_400_000)).toBe(false);
    expect(deckBetaBannerLive(0, "not a date")).toBe(false);
  });

  it("defaults to 30 days after the PR's merge day", () => {
    expect(DECK_BETA_BANNER_ENDS_AT).toBe("2026-11-28T00:00:00Z");
  });
});
