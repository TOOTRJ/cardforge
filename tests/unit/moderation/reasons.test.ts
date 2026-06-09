import { describe, expect, it } from "vitest";
import {
  REPORT_REASONS,
  REPORT_REASON_LABELS,
} from "@/lib/moderation/reasons";

describe("report reasons", () => {
  it("matches the DB check constraint set (0029)", () => {
    expect([...REPORT_REASONS].sort()).toEqual([
      "hateful",
      "ip",
      "nsfw",
      "other",
      "spam",
    ]);
  });

  it("has a human-readable label for every reason", () => {
    for (const reason of REPORT_REASONS) {
      expect(REPORT_REASON_LABELS[reason]?.length ?? 0).toBeGreaterThan(0);
    }
  });
});
