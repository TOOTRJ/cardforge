// ---------------------------------------------------------------------------
// Small pure helpers every analytics tab shares: a zero-filled day series, a
// change against the previous period, and how numbers are written. Client-
// safe.
// ---------------------------------------------------------------------------

export type DayPoint = { day: string; value: number };

/** A UTC day key (YYYY-MM-DD) of a date or timestamp. */
export function utcDayKey(value: string | Date): string {
  return (typeof value === "string" ? new Date(value) : value).toISOString().slice(0, 10);
}

/** One point per day of `dayKeys`, 0 where `rows` has none (rows of a day
 *  outside the keys are left out; several rows of one day add up). */
export function fillDays(dayKeys: readonly string[], rows: ReadonlyArray<{ day: string; value: number }>): DayPoint[] {
  const byDay = new Map<string, number>();
  for (const row of rows) {
    const day = row.day.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + (Number.isFinite(row.value) ? row.value : 0));
  }
  return dayKeys.map((day) => ({ day, value: byDay.get(day) ?? 0 }));
}

/** Count rows per UTC day of their timestamp. */
export function countByDay(dayKeys: readonly string[], timestamps: ReadonlyArray<string>): DayPoint[] {
  return fillDays(
    dayKeys,
    timestamps.map((at) => ({ day: utcDayKey(at), value: 1 })),
  );
}

export type Change = {
  /** Signed fraction: 0.25 = up a quarter. Null when there is nothing to
   *  compare with (the previous period was 0). */
  ratio: number | null;
  direction: "up" | "down" | "flat";
};

/** How `current` compares with `previous`. */
export function changeOf(current: number, previous: number): Change {
  if (current === previous) return { ratio: previous === 0 ? null : 0, direction: "flat" };
  if (previous === 0) return { ratio: null, direction: "up" };
  const ratio = (current - previous) / previous;
  return { ratio, direction: ratio > 0 ? "up" : "down" };
}

/** "+25%" / "−8%" / "new" (from nothing) / "no change". The minus is a
 *  real minus sign: these are numbers, not hyphenated words. */
export function changeText(change: Change): string {
  if (change.direction === "flat") return "no change";
  if (change.ratio === null) return "new";
  const percent = Math.abs(change.ratio) * 100;
  const shown = percent >= 10 ? Math.round(percent) : Math.round(percent * 10) / 10;
  return `${change.ratio > 0 ? "+" : "−"}${shown}%`;
}

/** 1,284 — whole numbers in full (admin tables are read exactly). */
export function formatCount(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

/** "63%" / "—" when there is nothing to divide by. One decimal under 10%. */
export function formatRate(part: number, whole: number): string {
  if (whole <= 0) return "—";
  const percent = (part / whole) * 100;
  return `${percent >= 10 || percent === 0 ? Math.round(percent) : Math.round(percent * 10) / 10}%`;
}

/** $1,284.50 from cents, in the payment's own currency. */
export function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}
