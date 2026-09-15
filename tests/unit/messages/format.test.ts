import { describe, expect, it } from "vitest";
import { formatBadgeCount, formatRelativeTime } from "@/components/messages/format";

describe("formatRelativeTime", () => {
  const now = Date.parse("2026-09-14T12:00:00Z");
  const at = (iso: string) => formatRelativeTime(iso, now);
  it("buckets by minute, hour, day, then a short date", () => {
    expect(at("2026-09-14T11:59:40Z")).toBe("just now");
    expect(at("2026-09-14T11:45:00Z")).toBe("15m ago");
    expect(at("2026-09-14T09:00:00Z")).toBe("3h ago");
    expect(at("2026-09-12T12:00:00Z")).toBe("2d ago");
    expect(at("2026-08-01T12:00:00Z")).toBe("Aug 1");
    expect(at("2025-08-01T12:00:00Z")).toBe("Aug 1, 2025");
  });
  it("returns the input untouched when it isn't a date", () => {
    expect(at("garbage")).toBe("garbage");
  });
});

describe("formatBadgeCount", () => {
  it("caps at 9+", () => {
    expect(formatBadgeCount(1)).toBe("1");
    expect(formatBadgeCount(9)).toBe("9");
    expect(formatBadgeCount(10)).toBe("9+");
  });
});
