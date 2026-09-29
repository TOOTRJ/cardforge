import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sameOwnerBackCard } from "@/lib/cards/back-card";

// ---------------------------------------------------------------------------
// A card's v2 back face is another of its OWNER's cards (review 2026-09-29).
// Migration 0127's cards_guard_back_card refuses anything else as a new
// value; a row written before it is skipped on the card page, so its flip
// never draws another user's card under this one's name.
// ---------------------------------------------------------------------------

const ME = "11111111-1111-4111-8111-111111111111";
const THEM = "99999999-9999-4999-8999-999999999999";

describe("sameOwnerBackCard", () => {
  it("keeps the owner's own back card and drops anyone else's", () => {
    const mine = { id: "b1", owner_id: ME, title: "Back" };
    expect(sameOwnerBackCard({ owner_id: ME }, mine)).toBe(mine);
    expect(sameOwnerBackCard({ owner_id: ME }, { id: "b2", owner_id: THEM })).toBeNull();
    expect(sameOwnerBackCard({ owner_id: ME }, null)).toBeNull();
    expect(sameOwnerBackCard({ owner_id: ME }, undefined)).toBeNull();
  });

  it("the card page resolves its back card through it", () => {
    const page = readFileSync(join(process.cwd(), "components/cards/card-detail-content.tsx"), "utf8");
    expect(page).toContain("getCardById(card.back_card_id).then((back) => sameOwnerBackCard(card, back))");
    expect(page).not.toMatch(/\? getCardById\(card\.back_card_id\)\s*:/);
  });
});
