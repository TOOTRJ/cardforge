import { describe, expect, it } from "vitest";
import { isAllowedUpdateLink, isReleased, needsAck, siteUpdateStatus, toDateTimeLocal } from "@/lib/updates/shared";

const NOW = new Date("2026-09-15T12:00:00Z");

describe("site update status", () => {
  it("is draft when unpublished, scheduled when ahead, live otherwise", () => {
    expect(siteUpdateStatus({ is_published: false, publish_at: "2026-01-01T00:00:00Z" }, NOW)).toBe("draft");
    expect(siteUpdateStatus({ is_published: true, publish_at: "2026-09-16T00:00:00Z" }, NOW)).toBe("scheduled");
    expect(siteUpdateStatus({ is_published: true, publish_at: "2026-09-15T11:59:00Z" }, NOW)).toBe("live");
    expect(isReleased({ is_published: true, publish_at: "2026-09-16T00:00:00Z" }, NOW)).toBe(false);
  });

  it("asks for acknowledgement only while live, flagged and before ack_until", () => {
    const base = { is_published: true, publish_at: "2026-09-01T00:00:00Z", require_ack: true, ack_until: null };
    expect(needsAck(base, NOW)).toBe(true);
    expect(needsAck({ ...base, require_ack: false }, NOW)).toBe(false);
    expect(needsAck({ ...base, publish_at: "2026-10-01T00:00:00Z" }, NOW)).toBe(false);
    expect(needsAck({ ...base, ack_until: "2026-09-10T00:00:00Z" }, NOW)).toBe(false);
    expect(needsAck({ ...base, ack_until: "2026-09-20T00:00:00Z" }, NOW)).toBe(true);
  });

  it("formats datetime-local values and tolerates garbage", () => {
    expect(toDateTimeLocal("2026-09-15T12:34:00Z")).toBe("2026-09-15T12:34");
    expect(toDateTimeLocal("nope")).toBe("");
    expect(toDateTimeLocal(null)).toBe("");
  });
});

describe("update link", () => {
  it("takes https:// URLs and site paths", () => {
    expect(isAllowedUpdateLink("https://pipglyph.com/news")).toBe(true);
    expect(isAllowedUpdateLink("/create")).toBe(true);
    expect(isAllowedUpdateLink("/")).toBe(true);
    expect(isAllowedUpdateLink("/gallery?tag=elves")).toBe(true);
  });

  it("refuses a protocol-relative URL that leaves the site", () => {
    expect(isAllowedUpdateLink("//evil.example")).toBe(false);
    expect(isAllowedUpdateLink("/\\evil.example")).toBe(false);
    expect(isAllowedUpdateLink("http://pipglyph.com")).toBe(false);
    expect(isAllowedUpdateLink("javascript:alert(1)")).toBe(false);
    expect(isAllowedUpdateLink("/has space")).toBe(false);
  });
});
