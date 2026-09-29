import { describe, expect, it } from "vitest";
import {
  allFramePreviewsMessage,
  bulkVisibilityMessage,
} from "@/lib/cards/bulk-visibility-copy";

// ---------------------------------------------------------------------------
// The words for a bulk visibility change in My Cards (owner, 2026-09-28): a
// batch with frame previews says plainly that they were skipped and stay
// private; a batch without keeps the old short wording.
// ---------------------------------------------------------------------------

describe("bulkVisibilityMessage", () => {
  it("says what was published and how many previews were skipped", () => {
    expect(bulkVisibilityMessage("public", 5, 2)).toBe(
      "Published 5 cards. Skipped 2 frame previews — they stay private.",
    );
    expect(bulkVisibilityMessage("public", 1, 1)).toBe(
      "Published 1 card. Skipped 1 frame preview — it stays private.",
    );
    expect(bulkVisibilityMessage("unlisted", 3, 1)).toBe(
      "Made 3 cards unlisted. Skipped 1 frame preview — it stays private.",
    );
  });

  it("a batch without previews keeps the old wording", () => {
    expect(bulkVisibilityMessage("public", 5, 0)).toBe("5 cards → public.");
    expect(bulkVisibilityMessage("private", 1, 0)).toBe("1 card → private.");
    expect(bulkVisibilityMessage("unlisted", 2, 0)).toBe("2 cards → unlisted.");
  });
});

describe("allFramePreviewsMessage", () => {
  it("says nothing changed and why", () => {
    expect(allFramePreviewsMessage("public", 2)).toBe(
      "Nothing was published: all 2 selected cards are frame previews, and frame previews stay private.",
    );
    expect(allFramePreviewsMessage("public", 1)).toBe(
      "Nothing was published: the selected card is a frame preview, and frame previews stay private.",
    );
    expect(allFramePreviewsMessage("unlisted", 3)).toMatch(/^Nothing was made unlisted: all 3/);
  });
});
