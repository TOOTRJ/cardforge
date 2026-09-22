import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CARD_CAPACITY, CARD_CAPACITY_UNLIMITED } from "@/lib/billing/plans";
import {
  CAPACITY_WARN_AT,
  describeCapacity,
  describeUsage,
  overCapacity,
  isCapacityViolation,
  remainingCapacity,
  type CardCapacity,
} from "@/lib/billing/capacity-copy";

// ---------------------------------------------------------------------------
// Saved-card capacity: the app's numbers and the database trigger must agree,
// and the warning copy must fire exactly when an action would cross the cap.
// ---------------------------------------------------------------------------

const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/0104_card_capacity_enforcement.sql"),
  "utf8",
);

describe("migration 0104 mirrors CARD_CAPACITY", () => {
  it("uses the same plus / free caps and unlimited sentinel", () => {
    expect(MIGRATION).toContain(`when tier = 'plus' then greatest(${CARD_CAPACITY.plus},`);
    expect(MIGRATION).toContain(`else greatest(${CARD_CAPACITY.free},`);
    expect(MIGRATION).toContain(`when tier = 'pro' then ${CARD_CAPACITY_UNLIMITED}`);
    expect(MIGRATION).toContain(`when is_admin then ${CARD_CAPACITY_UNLIMITED}`);
    // A missing profile row falls back to the free cap, never to a free pass.
    expect(MIGRATION).toContain(`coalesce(public.card_capacity_for(new.owner_id), ${CARD_CAPACITY.free})`);
  });
  it("raises the message the app maps to the upgrade prompt", () => {
    expect(MIGRATION).toContain("raise exception 'card_capacity_exceeded");
    expect(isCapacityViolation('card_capacity_exceeded: 50 of 50 saved cards')).toBe(true);
    expect(isCapacityViolation("duplicate key value")).toBe(false);
    expect(isCapacityViolation(null)).toBe(false);
  });
});

const free = (used: number): CardCapacity => ({ used, cap: CARD_CAPACITY.free, tier: "free" });

describe("over the cap (lapsed plan)", () => {
  it("says the cards are safe and how much room a save needs", () => {
    const lapsed = { used: 212, cap: CARD_CAPACITY.free, tier: "free" as const };
    expect(overCapacity(lapsed)).toBe(212 - CARD_CAPACITY.free);
    expect(remainingCapacity(lapsed)).toBe(0);
    expect(describeUsage(lapsed)).toMatchObject({ tone: "danger" });
    expect(describeUsage(lapsed)?.message).toContain("212 cards, 162 over the Free plan's 50-card limit");
    expect(describeUsage(lapsed)?.message).toContain("They're safe");
    expect(describeCapacity(lapsed, 1)?.message).toContain("162 over your Free plan's 50-card limit");
    expect(describeCapacity(lapsed, 1)?.message).toContain("delete 163 cards");
    expect(describeCapacity(lapsed, 3)?.message).toContain("adding 3 cards needs room: delete 165 cards");
    // Exactly at the cap is "full", not "over".
    expect(overCapacity({ used: CARD_CAPACITY.free, cap: CARD_CAPACITY.free, tier: "free" })).toBe(0);
    expect(overCapacity({ used: 9_000, cap: CARD_CAPACITY_UNLIMITED, tier: "pro" })).toBe(0);
  });
});

describe("describeCapacity", () => {
  it("says nothing on an unlimited plan or with plenty of room", () => {
    expect(describeCapacity({ used: 9_000, cap: CARD_CAPACITY_UNLIMITED, tier: "pro" }, 100)).toBeNull();
    expect(describeCapacity(free(10), 1)).toBeNull();
    expect(describeCapacity(null, 1)).toBeNull();
  });
  it("warns softly when the action lands within the last few slots", () => {
    const notice = describeCapacity(free(CARD_CAPACITY.free - CAPACITY_WARN_AT - 1), 1);
    expect(notice?.tone).toBe("warning");
    expect(notice?.message).toContain(`${CAPACITY_WARN_AT} slots left`);
    expect(describeCapacity(free(CARD_CAPACITY.free - 1), 1)).toMatchObject({
      tone: "warning",
      message: expect.stringContaining("last of your 50 card slots"),
    });
  });
  it("blocks in words when the action would cross the cap, with the numbers", () => {
    expect(describeCapacity(free(45), 10)).toMatchObject({
      tone: "danger",
      message: expect.stringContaining("Adding 10 cards would take you over"),
    });
    expect(describeCapacity(free(45), 10)?.message).toContain("5 slots left");
    expect(describeCapacity(free(50), 1)).toMatchObject({
      tone: "danger",
      message: expect.stringContaining("limit is full"),
    });
    expect(describeCapacity(free(50), 25)?.message).toContain("can't add 25 cards");
  });
  it("remainingCapacity never goes negative for over-cap accounts", () => {
    expect(remainingCapacity(free(60))).toBe(0);
    expect(remainingCapacity({ used: 1, cap: CARD_CAPACITY_UNLIMITED, tier: "pro" })).toBeNull();
  });
});

describe("describeUsage", () => {
  it("is the always-on meter, toned by how close the cap is", () => {
    expect(describeUsage(free(10))).toMatchObject({ tone: "info", message: "10 of 50 card slots used on Free." });
    expect(describeUsage(free(47))?.tone).toBe("warning");
    expect(describeUsage(free(50))?.tone).toBe("danger");
    expect(describeUsage({ used: 3, cap: CARD_CAPACITY_UNLIMITED, tier: "pro" })).toBeNull();
  });
});
