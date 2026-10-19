import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ALERT_ERROR_MAX,
  CREDIT_REFILL_FAILED,
  cronAlertDedupeKey,
  cutError,
  invoiceAlertDedupeKey,
  notifyAdminsCreditRefillFailed,
  type CreditRefillFailedPayload,
  type CronRefillFailurePayload,
} from "@/lib/billing/credit-alerts";
import { makeAlertAdmin } from "./helpers/alert-admin";

// ---------------------------------------------------------------------------
// notifyAdminsCreditRefillFailed — ONE credit_refill_failed row per admin per
// dedupe key (migration 0140), and never a throw.
// ---------------------------------------------------------------------------

const cronPayload = (day: string): CronRefillFailurePayload => ({
  source: "cron",
  dedupeKey: `cron:${day}`,
  period: day.slice(0, 7),
  day,
  processed: 10,
  granted: 8,
  failed: 2,
  pageError: null,
  userIds: ["u-1", "u-2"],
  error: "permission denied for function grant_credits",
});

let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errorLog.mockRestore());

describe("dedupe keys", () => {
  it("the cron's is its UTC run day; an invoice's is its id", () => {
    expect(cronAlertDedupeKey(new Date("2026-10-18T23:59:59Z"))).toBe("cron:2026-10-18");
    expect(cronAlertDedupeKey(new Date("2026-10-19T00:00:00Z"))).toBe("cron:2026-10-19");
    expect(invoiceAlertDedupeKey("in_123")).toBe("invoice:in_123");
  });

  it("cuts a long error to ALERT_ERROR_MAX characters", () => {
    expect(cutError("short")).toBe("short");
    const cut = cutError("x".repeat(1000));
    expect(cut).toHaveLength(ALERT_ERROR_MAX);
    expect(cut.endsWith("…")).toBe(true);
  });
});

describe("notifyAdminsCreditRefillFailed", () => {
  it("notifies every admin once, and a second call with the same key notifies nobody", async () => {
    const { admin, notifications } = makeAlertAdmin({ adminIds: ["a-1", "a-2"] });
    expect(await notifyAdminsCreditRefillFailed(admin, cronPayload("2026-10-18"))).toBe(2);
    expect(notifications).toEqual([
      { recipient_id: "a-1", actor_id: null, type: CREDIT_REFILL_FAILED, payload: cronPayload("2026-10-18") },
      { recipient_id: "a-2", actor_id: null, type: CREDIT_REFILL_FAILED, payload: cronPayload("2026-10-18") },
    ]);
    expect(await notifyAdminsCreditRefillFailed(admin, { ...cronPayload("2026-10-18"), failed: 5 })).toBe(0);
    expect(notifications).toHaveLength(2);
  });

  it("alerts again on the next day while failures persist", async () => {
    const { admin, notifications } = makeAlertAdmin({ adminIds: ["a-1"] });
    await notifyAdminsCreditRefillFailed(admin, cronPayload("2026-10-18"));
    await notifyAdminsCreditRefillFailed(admin, cronPayload("2026-10-19"));
    expect(notifications.map((n) => n.payload.dedupeKey)).toEqual(["cron:2026-10-18", "cron:2026-10-19"]);
  });

  it("an admin added later in the day still gets the day's alert; the others don't get a second", async () => {
    const first = makeAlertAdmin({ adminIds: ["a-1"] });
    await notifyAdminsCreditRefillFailed(first.admin, cronPayload("2026-10-18"));
    const later = makeAlertAdmin({ adminIds: ["a-1", "a-2"], notifications: first.notifications });
    expect(await notifyAdminsCreditRefillFailed(later.admin, cronPayload("2026-10-18"))).toBe(1);
    expect(later.insertCalls).toEqual([[expect.objectContaining({ recipient_id: "a-2" })]]);
  });

  it("a racing run's insert that hits the unique index (23505) counts as already alerted", async () => {
    const seeded = makeAlertAdmin({ adminIds: ["a-1"] });
    await notifyAdminsCreditRefillFailed(seeded.admin, cronPayload("2026-10-18"));
    const racing = makeAlertAdmin({ adminIds: ["a-1"], notifications: seeded.notifications, blindDedupeRead: true });
    expect(await notifyAdminsCreditRefillFailed(racing.admin, cronPayload("2026-10-18"))).toBe(0);
    expect(racing.notifications).toHaveLength(1);
    expect(errorLog).not.toHaveBeenCalled();
  });

  it("dedupes an invoice by its id", async () => {
    const payload: CreditRefillFailedPayload = {
      source: "invoice",
      dedupeKey: invoiceAlertDedupeKey("in_1"),
      invoiceId: "in_1",
      userId: "u-1",
      error: "boom",
    };
    const { admin, notifications } = makeAlertAdmin({ adminIds: ["a-1"] });
    await notifyAdminsCreditRefillFailed(admin, payload);
    await notifyAdminsCreditRefillFailed(admin, payload);
    await notifyAdminsCreditRefillFailed(admin, { ...payload, dedupeKey: invoiceAlertDedupeKey("in_2"), invoiceId: "in_2" });
    expect(notifications.map((n) => n.payload.invoiceId)).toEqual(["in_1", "in_2"]);
  });

  it("never throws: no admin, a failed lookup or a failed insert is logged and answers 0", async () => {
    expect(await notifyAdminsCreditRefillFailed(makeAlertAdmin({ adminIds: [] }).admin, cronPayload("2026-10-18"))).toBe(0);
    expect(
      await notifyAdminsCreditRefillFailed(
        makeAlertAdmin({ adminIds: ["a-1"], adminLookupError: "db down" }).admin,
        cronPayload("2026-10-18"),
      ),
    ).toBe(0);
    expect(
      await notifyAdminsCreditRefillFailed(
        makeAlertAdmin({ adminIds: ["a-1"], insertError: "check violation" }).admin,
        cronPayload("2026-10-18"),
      ),
    ).toBe(0);
    const throwing = { from: () => { throw new Error("client exploded"); } } as never;
    await expect(notifyAdminsCreditRefillFailed(throwing, cronPayload("2026-10-18"))).resolves.toBe(0);
    expect(errorLog).toHaveBeenCalledTimes(3);
  });
});
