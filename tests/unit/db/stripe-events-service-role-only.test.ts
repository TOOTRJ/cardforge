import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// The webhook's idempotency table (stripe_events) is the service role's alone
// (Stripe audit 2026-11-05): revoke-first from every API role, the service
// role keeps the four it uses. Found by NAME, never by number.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const files = readdirSync(dir).filter((f) => /^\d{4}_stripe_events_service_role_only\.sql$/.test(f));
const sql = files[0] ? readFileSync(join(dir, files[0]), "utf8") : "";

describe("the stripe_events grants migration", () => {
  it("is one file", () => {
    expect(files).toHaveLength(1);
  });
  it("revokes every API role first, then grants the service role what the webhook route uses", () => {
    const revoke = sql.indexOf("revoke all on table public.stripe_events from public, anon, authenticated;");
    expect(revoke).toBeGreaterThan(0);
    expect(sql.indexOf("grant select, insert, update, delete on table public.stripe_events to service_role;")).toBeGreaterThan(revoke);
    expect(sql).not.toMatch(/grant [^;]*on table public\.stripe_events to (anon|authenticated)/);
    expect(sql).not.toMatch(/grant all on all tables/i);
  });
  it("the webhook route still touches the table through the admin (service role) client only", () => {
    const route = readFileSync(join(process.cwd(), "app/api/stripe/webhook/route.ts"), "utf8");
    const uses = route.match(/from\("stripe_events"\)/g) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(4);
    expect(route).toContain("createAdminClient");
  });
});
