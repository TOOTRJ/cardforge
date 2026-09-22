import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LEDGER_REASON_LABELS, describeLedgerReason } from "@/lib/billing/ledger-reasons";

// ---------------------------------------------------------------------------
// The usage ledger labels every reason the code actually writes: the grant
// reasons (credit-refill, the webhook, admin grants, the signup trigger,
// refunds) and every AiActionLabel a spend can carry. A reason without a
// label falls through to the humaniser, which is how "subscription_refill"
// printed as "Subscription refill" for months.
// ---------------------------------------------------------------------------

const GRANT_REASONS = ["admin_grant", "signup_grant", "subscription_refill", "pack_purchase", "refund"];

function aiActionLabels(): string[] {
  const source = readFileSync(join(process.cwd(), "lib/ai/rate-limit.ts"), "utf8");
  const union = /export type AiActionLabel =([\s\S]*?);/.exec(source);
  expect(union).not.toBeNull();
  return [...union![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
}

describe("ledger reason labels", () => {
  it("cover every grant reason and every AI action label", () => {
    for (const reason of [...GRANT_REASONS, ...aiActionLabels()]) {
      expect(LEDGER_REASON_LABELS[reason], reason).toBeTruthy();
    }
  });

  it("never render an admin's private note", () => {
    expect(describeLedgerReason("admin_grant: comped for the bug report")).toBe(
      "Credits added by the PipGlyph team",
    );
  });

  it("humanise an unknown reason and default an empty one", () => {
    expect(describeLedgerReason("mystery_reason")).toBe("Mystery reason");
    expect(describeLedgerReason(null)).toBe("Credit adjustment");
  });
});
