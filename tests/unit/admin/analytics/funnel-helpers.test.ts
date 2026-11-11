import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/admin/users-queries", () => ({ requireAdminClient: async () => null }));

import { COHORT_STEPS, SIGNUP_NOT_RECORDED, buildCohort, buildSignupsDaily, getFunnelSummary } from "@/lib/admin/funnel-queries";
import { analyticsPeriod } from "@/lib/admin/analytics/params";

// ---------------------------------------------------------------------------
// The Funnel tab's new shapes (the 2026-11 analytics audit): the COHORT —
// the people who signed up in the period and how far they have come, which
// replaces "Rate 30d" (one step's events over the step before's: unrelated
// counts) — and the signups per day and by how the account was made.
// ---------------------------------------------------------------------------

describe("buildCohort", () => {
  it("is the six steps in funnel order, whatever order the rows came in", () => {
    const cohort = buildCohort([
      { step: "trial_converted", users: 3 },
      { step: "first_card_saved", users: 109 },
      { step: "signup", users: 174 },
      { step: "trial_started", users: 12 },
      { step: "first_download", users: 40 },
      { step: "first_ai_generation", users: 61 },
    ]);
    expect(cohort.map((step) => [step.key, step.users])).toEqual([
      ["signup", 174],
      ["first_card_saved", 109],
      ["first_ai_generation", 61],
      ["first_download", 40],
      ["trial_started", 12],
      ["trial_converted", 3],
    ]);
    expect(cohort.map((step) => step.key)).toEqual([...COHORT_STEPS]);
    // Said about people, since these are people.
    expect(cohort.map((step) => step.label)).toEqual([
      "Signed up",
      "Saved a first card",
      "Made a first AI generation",
      "Downloaded a card",
      "Started a trial",
      "Trial became a paid plan",
    ]);
  });

  it("a later step can never be read as more than the cohort: every number is a count of the SAME people", () => {
    // The old "rate" put 109 first cards over 42 signups. A cohort's step is a subset of its signups.
    const cohort = buildCohort([
      { step: "signup", users: 42 },
      { step: "first_card_saved", users: 30 },
    ]);
    for (const step of cohort) expect(step.users).toBeLessThanOrEqual(cohort[0].users);
  });

  it("a step the read did not name is 0, bigints arrive as text, and a step it does not know is left out", () => {
    const cohort = buildCohort([
      { step: "signup", users: "12" },
      { step: "made_up", users: 99 },
    ]);
    expect(cohort).toHaveLength(6);
    expect(cohort[0].users).toBe(12);
    expect(cohort.slice(1).every((step) => step.users === 0)).toBe(true);
    expect(buildCohort([]).every((step) => step.users === 0)).toBe(true);
  });
});

describe("buildSignupsDaily", () => {
  const dayKeys = ["2026-11-08", "2026-11-09", "2026-11-10"];
  const rows = [
    { day: "2026-11-08", method: "email", n: 2 },
    { day: "2026-11-08", method: "google", n: 5 },
    { day: "2026-11-10", method: "google", n: 1 },
    { day: "2026-11-10", method: "discord", n: 2 },
    { day: "2026-11-10", method: SIGNUP_NOT_RECORDED, n: 2 },
  ];

  it("one point per day of the period, a quiet day as 0, the methods of a day added up", () => {
    const signups = buildSignupsDaily(dayKeys, rows);
    expect(signups.points).toEqual([
      { day: "2026-11-08", value: 7 },
      { day: "2026-11-09", value: 0 },
      { day: "2026-11-10", value: 5 },
    ]);
    expect(signups.total).toBe(12);
  });

  it("the ways people signed up, biggest first — a tie in the list's own order — each by its name", () => {
    expect(buildSignupsDaily(dayKeys, rows).methods).toEqual([
      { method: "google", label: "Google", n: 6 },
      { method: "email", label: "Email", n: 2 },
      { method: "discord", label: "Discord", n: 2 },
      { method: "not recorded", label: "Not recorded", n: 2 },
    ]);
  });

  it("the chart and the list add up to the same total: a row of a day outside the period is in neither", () => {
    const signups = buildSignupsDaily(dayKeys, [...rows, { day: "2026-11-07", method: "email", n: 50 }]);
    expect(signups.total).toBe(12);
    expect(signups.points.reduce((sum, point) => sum + point.value, 0)).toBe(12);
    expect(signups.methods.reduce((sum, row) => sum + row.n, 0)).toBe(12);
  });

  it("a way nobody used is not listed, an unknown one prints as it came, and no signups is no list", () => {
    const signups = buildSignupsDaily(dayKeys, [
      { day: "2026-11-09", method: "other", n: "3" },
      { day: "2026-11-09", method: "passkey", n: 1 },
      { day: "2026-11-09", method: "email", n: 0 },
    ]);
    expect(signups.methods).toEqual([
      { method: "other", label: "Other", n: 3 },
      { method: "passkey", label: "passkey", n: 1 },
    ]);
    expect(buildSignupsDaily(dayKeys, [])).toEqual({ points: dayKeys.map((day) => ({ day, value: 0 })), methods: [], total: 0 });
  });

  it("reads a timestamp-shaped day by its date", () => {
    expect(buildSignupsDaily(dayKeys, [{ day: "2026-11-09T00:00:00+00:00", method: "email", n: 4 }]).points[1]).toEqual({ day: "2026-11-09", value: 4 });
  });
});

describe("getFunnelSummary", () => {
  it("is null for a viewer who is not an admin — nothing is read", async () => {
    expect(await getFunnelSummary(analyticsPeriod(30))).toBeNull();
  });
});
