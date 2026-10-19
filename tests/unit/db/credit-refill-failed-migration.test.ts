import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// 0140 — the credit_refill_failed kind (lib/billing/credit-alerts.ts):
//   * the notification CHECK is 0120's list plus the new kind — dropping a
//     kind would break every insert of it;
//   * the dedupe is a UNIQUE partial index on (dedupeKey, recipient) for
//     that kind only — every other kind's rows are untouched;
//   * the seeded preview row uses a key no real run can have, so it never
//     suppresses a real alert.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const strip = (sql: string) =>
  sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
const SQL = strip(readFileSync(join(dir, "0140_credit_refill_failed_notifications.sql"), "utf8"));
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

function typeCheckKinds(sql: string): string[] {
  const all = [...sql.matchAll(/add constraint notifications_type_check\s+check \(\s*type in \(([\s\S]*?)\)\s*\)/g)];
  const last = all.at(-1);
  if (!last) throw new Error("no notifications_type_check");
  return [...last[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

describe("0140 — credit_refill_failed notifications", () => {
  it("the notification CHECK is 0120's kinds plus credit_refill_failed", () => {
    const before = typeCheckKinds(strip(readFileSync(join(dir, "0120_auto_rebake.sql"), "utf8")));
    expect(typeCheckKinds(SQL)).toEqual([...before, "credit_refill_failed"]);
  });

  it("dedupes with a unique partial index on the payload's key and the recipient, for this kind only", () => {
    expect(squash(SQL)).toContain(
      squash(`create unique index if not exists notifications_credit_refill_failed_once_idx
        on public.notifications ((payload ->> 'dedupeKey'), recipient_id)
        where type = 'credit_refill_failed';`),
    );
  });

  it("creates no table or function (nothing to grant) and touches no other object", () => {
    expect(SQL).not.toMatch(/create (table|(or replace )?function)/i);
    expect(SQL).not.toMatch(/\b(insert|update|delete)\b/i);
  });

  it("the preview seed row uses a key no real cron day or invoice can have", () => {
    const seed = readFileSync(join(process.cwd(), "supabase/seeds/23_credit_refill_alert.sql"), "utf8");
    expect(seed).toContain("'credit_refill_failed'");
    expect(seed).toContain("'dedupeKey', 'seed:example'");
    expect(seed).toContain("on conflict do nothing");
  });
});
