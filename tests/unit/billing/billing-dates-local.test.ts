import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DATE_FORMATS,
  dateTextToString,
  formatCalendarDate,
  formatDateIn,
  formatShortDate,
  formatUtcDate,
  formatUtcDateTime,
  formatUtcTime,
} from "@/lib/format/dates";
import { planEndingAdminLabel, planEndingSentence, planEndingShort } from "@/lib/billing/plan-ending";
import { cancellationStats } from "@/lib/admin/user-cancellation";
import { trialEndingEmail } from "@/lib/email/messages";

// ---------------------------------------------------------------------------
// Billing dates (2026-10-07): a SUBSCRIBER reads them in their own time zone
// (<LocalDate>, components/ui/local-date.tsx — its behaviour is tested in
// tests/unit/components/local-date.test.tsx); an ADMIN reads them in UTC,
// labelled; a server-built message says which zone it means.
// ---------------------------------------------------------------------------

const ENDS = "2026-11-08T02:31:04.000Z"; // November 7 in the Americas
const read = (file: string) => readFileSync(path.resolve(process.cwd(), file), "utf8");

describe("lib/format/dates — one source of the date shapes", () => {
  it("the same shape in any zone: only the day can differ", () => {
    expect(formatDateIn(ENDS, "long", "UTC")).toBe("November 8, 2026");
    expect(formatDateIn(ENDS, "long", "America/New_York")).toBe("November 7, 2026");
    expect(formatDateIn(ENDS, "short", "America/Los_Angeles")).toBe("Nov 7, 2026");
    expect(formatDateIn(ENDS, "short", "Asia/Tokyo")).toBe("Nov 8, 2026");
    expect(formatDateIn("soon", "long", "UTC")).toBe("soon");
  });

  it("the older helpers print exactly what they did", () => {
    expect(formatCalendarDate("2026-09-14")).toBe("September 14, 2026");
    expect(formatCalendarDate(ENDS)).toBe("November 8, 2026");
    expect(formatShortDate("2026-09-14T12:00:00Z")).toBe("Sep 14, 2026");
    expect(formatShortDate("nope", "—")).toBe("—");
    expect(DATE_FORMATS.long).toEqual({ month: "long", day: "numeric", year: "numeric" });
    expect(DATE_FORMATS.short).toEqual({ month: "short", day: "numeric", year: "numeric" });
  });

  it("a sentence in parts is one string in the zone the caller names — undefined is NOT UTC", () => {
    const parts = ["ends ", { date: ENDS, format: "short" as const }, "."];
    expect(dateTextToString(parts, "UTC")).toBe("ends Nov 8, 2026.");
    expect(dateTextToString(parts, "America/Chicago")).toBe("ends Nov 7, 2026.");
    // The suite runs in UTC (vitest.config.ts), so the runtime's zone is UTC here.
    expect(dateTextToString(parts, undefined)).toBe("ends Nov 8, 2026.");
    expect(dateTextToString.length).toBe(2); // no default: the zone is always named
  });

  it("server-built copy stays UTC", () => {
    const ending = { kind: "plan" as const, endsAt: ENDS, billedBeforeAt: null, canceledAt: null };
    expect(planEndingSentence(ending, "Pro")).toContain("ends on November 8, 2026.");
    expect(planEndingShort(ending)).toBe("ends Nov 8, 2026");
  });
});

describe("admin pages: UTC, and they say so", () => {
  const ending = { kind: "plan" as const, endsAt: ENDS, billedBeforeAt: null, canceledAt: "2026-10-09T23:50:00.000Z" };

  it("the helpers label the zone", () => {
    expect(formatUtcDate(ENDS)).toBe("Nov 8, 2026 UTC");
    expect(formatUtcDate(ENDS, "long")).toBe("November 8, 2026 UTC");
    expect(formatUtcDateTime(ENDS)).toBe("Nov 8, 2026, 2:31 AM UTC");
    expect(formatUtcTime(ENDS)).toBe("2:31 AM UTC");
    expect(formatUtcDate("—")).toBe("—");
  });

  it("the directory badge and the detail rows", () => {
    expect(planEndingAdminLabel(ending)).toBe("cancelled, ends Nov 8, 2026 UTC");
    expect(planEndingAdminLabel({ ...ending, kind: "trial" })).toBe("trial cancelled, ends Nov 8, 2026 UTC");
    const stats = cancellationStats({ ...ending, billedBeforeAt: "2026-10-08T02:31:04.000Z" }, "active");
    expect(stats.endsAt).toBe("November 8, 2026 UTC");
    expect(stats.canceledAt).toBe("October 9, 2026 UTC");
    expect(stats.billedFirst).toBe("yes — renews October 8, 2026 UTC, then ends later");
  });

  it.each([
    ["app/(app)/admin/users/page.tsx", /formatUtcDateTime\(user\.current_period_end\)/],
    ["app/(app)/admin/users/page.tsx", /formatUtcDateTime\(user\.comp_expires_at\)/],
    ["components/admin/user-billing-controls.tsx", /formatUtcDate\(result\.endsAt\)/],
    ["components/admin/revenue-panel.tsx", /formatUtcDate\(payment\.paidAt/],
    ["components/admin/funnel-panel.tsx", /formatUtcDate\(t\.startedAt/],
  ])("%s prints its billing date through a labelled UTC helper", (file, pattern) => {
    expect(read(file)).toMatch(pattern);
  });
});

describe("every billing surface a subscriber sees prints its dates through <LocalDate>", () => {
  // file → what it shows. A new surface with a billing date belongs here.
  const SURFACES: Record<string, string> = {
    "components/billing/plan-status.tsx": "billing page: ends / renews / trial ends / scheduled change / comp until",
    "app/(app)/dashboard/billing/page.tsx": "billing page: invoice dates",
    "components/billing/resume-plan-button.tsx": "the Resume confirm: renews on / trial carries on until",
    "components/dashboard/plan-ending-notice.tsx": "dashboard notice + the plan badges' label",
    "components/dashboard/credits-summary.tsx": "dashboard credits badge",
    "components/dashboard/cards-summary.tsx": "dashboard saved-cards badge",
    "components/settings/billing-panel.tsx": "Settings: the cancelled-plan sentence",
    "app/(app)/settings/page.tsx": "Settings: renews on / trial ends on",
    "components/billing/plan-card.tsx": "plan grid: your current plan · ends",
    "components/billing/upgrade-modal.tsx": "upgrade modal: cancelled, ends",
    "components/layout/user-menu.tsx": "account menu: Billing · Pro ends",
  };
  const LOCAL = /\b(LocalDate|LocalDateText|useLocalDateText|PlanBadgeLabel)\b/;
  // A date formatted on the spot is a date in the SERVER's zone (or UTC).
  const SERVER_ZONE = /formatCalendarDate|formatShortDate|toLocaleDateString|timeZone:\s*"UTC"|dateTextToString|planEndingSentence\(|planEndingShort\(|planBadgeLabel\(|resumeConfirmCopy\(/;

  it.each(Object.entries(SURFACES))("%s (%s)", (file) => {
    const source = read(file);
    expect(source).toMatch(LOCAL);
    const body = source
      .split("\n")
      // the UTC twins are DEFINED (and documented) in two of these files
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line) && !/^export function /.test(line) && !/^\s*return dateTextToString\(/.test(line) && !/^import /.test(line) && !/^\s+(dateTextToString|type DateText),?$/.test(line))
      .join("\n");
    expect(body).not.toMatch(SERVER_ZONE);
  });

  it("the header hands the menu PARTS, not a formatted string", () => {
    const header = read("components/layout/site-header.tsx");
    expect(header).toMatch(/planEndingShortText\(/);
    expect(header).not.toMatch(/planEndingShort\(/);
  });

  it("the component itself is the only place a billing page picks a zone, and it reads the shared formats", () => {
    const source = read("components/ui/local-date.tsx");
    expect(source).toMatch(/^"use client";/);
    expect(source).toMatch(/suppressHydrationWarning/);
    expect(source).toMatch(/<time dateTime=\{iso\}/);
    expect(source).toMatch(/from "@\/lib\/format\/dates"/);
    expect(source).not.toMatch(/Intl\.DateTimeFormat|toLocale/);
  });
});

describe("server-built messages: UTC, and the one that states a charge says so", () => {
  const recipient = { userId: "u1", email: "a@example.com", name: "A" } as never;

  it("the trial-ending email names the UTC date and, where it states the charge, the time and the zone", () => {
    const email = trialEndingEmail(recipient, {
      plan: "Pro",
      trialEndsAt: ENDS,
      hasPaymentMethod: true,
      priceLabel: "$15 / month",
    });
    expect(email.subject).toBe("Your PipGlyph Pro trial ends November 8, 2026");
    expect(email.html).toContain("<strong>November 8, 2026</strong> (2:31 AM UTC)");
    const noCard = trialEndingEmail(recipient, { plan: "Plus", trialEndsAt: ENDS, hasPaymentMethod: false, priceLabel: null });
    expect(noCard.html).toContain("<strong>November 8, 2026</strong> (2:31 AM UTC)");
  });
});
