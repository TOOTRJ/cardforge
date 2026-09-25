import { describe, expect, it } from "vitest";
import { recordActivity, recordFunnelEvent } from "@/lib/analytics/funnel-server";

function makeAdmin(existingFirst: boolean) {
  const inserts: Array<Record<string, unknown>> = [];
  const admin = {
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        inserts.push(row);
        return { select: () => ({ single: async () => ({ data: { id: `fe_${inserts.length}` }, error: null }) }) };
      },
      select: () => {
        const chain = {
          eq: () => chain,
          limit: () => chain,
          maybeSingle: async () => ({ data: existingFirst ? { id: "fe_first" } : null, error: null }),
        };
        return chain;
      },
    }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { admin: admin as any, inserts };
}

describe("recordFunnelEvent / recordActivity", () => {
  it("writes the row with sanitized props and returns its id; unknown events are dropped", async () => {
    const { admin, inserts } = makeAdmin(false);
    const id = await recordFunnelEvent(admin, { event: "checkout_started", userId: "u1", props: { tier: "pro", email: "x@y" } });
    expect(id).toBe("fe_1");
    expect(inserts).toEqual([{ event: "checkout_started", user_id: "u1", props: { tier: "pro" }, source: "server" }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await recordFunnelEvent(admin, { event: "nope" as any, userId: "u1" })).toBeNull();
    expect(inserts).toHaveLength(1);
  });

  it("an activity records the activity row AND the once-per-user milestone the first time only", async () => {
    const first = makeAdmin(false);
    await recordActivity(first.admin, { userId: "u1", kind: "card_saved", props: { visibility: "public" } });
    expect(first.inserts.map((r) => r.event)).toEqual(["card_saved", "first_card_saved"]);

    const again = makeAdmin(true);
    await recordActivity(again.admin, { userId: "u1", kind: "download", props: { format: "png" } });
    expect(again.inserts.map((r) => r.event)).toEqual(["download"]);
  });
});
