import { describe, expect, it } from "vitest";
import { UUID_PATTERN, isUuid, randomId } from "@/lib/ids";

describe("isUuid", () => {
  it("accepts any RFC 4122 text form, case-insensitively", () => {
    expect(isUuid("123e4567-e89b-42d3-a456-426614174000")).toBe(true);
    expect(isUuid("123E4567-E89B-42D3-A456-426614174000")).toBe(true);
    expect(isUuid("00000000-0000-0000-0000-000000000000")).toBe(true);
  });
  it("rejects everything else, including probes and non-strings", () => {
    for (const value of [
      "",
      "not-a-uuid",
      "123e4567e89b42d3a456426614174000",
      "123e4567-e89b-42d3-a456-426614174000 ",
      "' OR 1=1",
      null,
      undefined,
      42,
    ]) {
      expect(isUuid(value)).toBe(false);
    }
  });
});

describe("randomId", () => {
  it("is a fresh UUID wherever crypto.randomUUID exists", () => {
    expect(UUID_PATTERN.test(randomId())).toBe(true);
    expect(randomId()).not.toBe(randomId());
  });
});
