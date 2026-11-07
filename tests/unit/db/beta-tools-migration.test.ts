import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { describeNotification } from "@/lib/notifications/describe";

// ---------------------------------------------------------------------------
// The beta tools migration (0182): RLS on every table, grants stated
// revoke-first, no API role writes a grant / interest / event row, the
// events and the analytics are the service role's, has_tool_access reads
// the rule in lib/tools/access.ts's order, the notification list keeps every
// kind 0179 allowed, and the seed is guarded. Found by NAME, never by number.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const file = readdirSync(dir).find((f) => /^\d{4}_beta_tools\.sql$/.test(f)) ?? "";
const sql = file ? readFileSync(join(dir, file), "utf8") : "";

function typeCheckKinds(text: string): string[] {
  const all = [...text.matchAll(/add constraint notifications_type_check\s+check \(\s*type in \(([\s\S]*?)\)\s*\)/g)];
  const last = all.at(-1);
  if (!last) throw new Error("no notifications_type_check");
  return [...last[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

function fn(name: string): string {
  const start = sql.search(new RegExp(`create (or replace )?function public\\.${name}\\(`));
  expect(start, name).toBeGreaterThanOrEqual(0);
  const open = sql.indexOf("$", start);
  const tag = sql.slice(open, sql.indexOf("$", open + 1) + 1);
  const end = sql.indexOf(tag, sql.indexOf(tag, open) + tag.length);
  return sql.slice(start, end + tag.length);
}

const TABLES = ["tool_releases", "tool_access_grants", "tool_interest", "tool_events"];

describe("0182 beta tools", () => {
  it("exists", () => {
    expect(file).not.toBe("");
  });

  it("turns RLS on and states each table's grants revoke-first", () => {
    for (const table of TABLES) {
      expect(sql, table).toContain(`alter table public.${table} enable row level security;`);
      const revoke = sql.indexOf(`revoke all on public.${table} from public, anon, authenticated;`);
      expect(revoke, table).toBeGreaterThan(0);
      const serviceGrant = sql.indexOf(
        `grant select, insert, update, delete on public.${table} to service_role;`,
      );
      expect(serviceGrant, table).toBeGreaterThan(revoke);
    }
  });

  it("gives the API roles read access only where a policy scopes it, and no writes", () => {
    expect(sql).toContain("grant select on public.tool_releases to anon, authenticated;");
    expect(sql).toContain("grant select on public.tool_access_grants to authenticated;");
    expect(sql).toContain("grant select on public.tool_interest to authenticated;");
    expect(sql).not.toMatch(/grant select on public\.tool_events to (anon|authenticated)/);
    expect(sql).not.toMatch(/grant [a-z, ]*(insert|update|delete)[a-z, ]* on public\.tool_\w+ to [a-z, ]*(anon|authenticated)/);
    // A user reads their own grants and interest; admins read all.
    expect(sql).toMatch(/Tool grants: own or admin read"[\s\S]*?using \(user_id = auth\.uid\(\) or public\.viewer_is_admin\(\)\)/);
    expect(sql).toMatch(/Tool interest: own or admin read"[\s\S]*?using \(user_id = auth\.uid\(\) or public\.viewer_is_admin\(\)\)/);
  });

  it("keeps the analytics functions to the service role", () => {
    for (const sig of ["admin_tool_summary()", "admin_tool_detail(text, integer)"]) {
      expect(sql).toContain(`revoke all on function public.${sig} from public, anon, authenticated;`);
      expect(sql).toContain(`grant execute on function public.${sig} to service_role;`);
    }
  });

  it("reads has_tool_access in the TS rule's order: admin, pause, plan, live grant", () => {
    const body = fn("has_tool_access");
    expect(body).toContain("security definer");
    expect(body).toContain("set search_path = ''");
    const admin = body.indexOf("me.is_admin");
    const paused = body.indexOf("not coalesce((select rel.paused from rel), false)");
    const plan = body.indexOf("rel.release_tier is not null");
    const grant = body.indexOf("from public.tool_access_grants g");
    expect(admin).toBeGreaterThan(0);
    expect(paused).toBeGreaterThan(admin);
    expect(plan).toBeGreaterThan(paused);
    expect(grant).toBeGreaterThan(plan);
    expect(body).toContain("g.expires_at is null or g.expires_at > now()");
    // The plan rank matches TIER_RANK (free 0, plus 1, pro 2) and the same
    // perks rule as entitlements (active / trialing / dunning grace, comps).
    expect(body).toContain("when 'pro' then 2 when 'plus' then 1 else 0");
    expect(body).toContain("public.subscription_perks_on(p.subscription_status, p.payment_failed_at)");
    expect(body).toContain("p.comp_expires_at is null or p.comp_expires_at > now()");
    expect(sql).toContain("grant execute on function public.has_tool_access(text) to authenticated, service_role;");
    expect(sql).toContain("revoke all on function public.has_tool_access(text) from public, anon;");
  });

  it("keeps every notification kind the previous list allowed, plus tool_access", () => {
    const previous = readdirSync(dir)
      .filter((f) => f < file && f.endsWith(".sql"))
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .filter((text) => text.includes("add constraint notifications_type_check"))
      .at(-1);
    expect(previous).toBeTruthy();
    const kinds = typeCheckKinds(sql);
    expect(kinds).toEqual(expect.arrayContaining(typeCheckKinds(previous!)));
    expect(kinds).toContain("tool_access");

    for (const later of readdirSync(dir).filter((f) => f > file && f.endsWith(".sql"))) {
      const text = readFileSync(join(dir, later), "utf8");
      if (!text.includes("notifications_type_check")) continue;
      expect(typeCheckKinds(text), later).toContain("tool_access");
    }
  });

  it("describes the tool_access notification for a built and an unbuilt tool", () => {
    const d = (payload: Record<string, unknown>) =>
      describeNotification(
        { type: "tool_access", actor: null, card: null, threadId: null, payload },
        { isAdmin: false },
      );
    const built = d({ tool: "token-kit", toolName: "Token Kit", built: true });
    expect(built.body).toContain("early access to Token Kit");
    expect(built.href).toBe("/dashboard/tools/token-kit");
    const soon = d({ tool: "token-kit", toolName: "Token Kit", built: false });
    expect(soon.body).toContain("Token Kit beta");
    expect(soon.href).toBe("/dashboard/tools");
  });

  it("seeds the tables behind the dev guard, with no credential", () => {
    const seed = readdirSync(join(process.cwd(), "supabase/seeds")).find((f) => /_beta_tools\.sql$/.test(f));
    expect(seed).toBeTruthy();
    const text = readFileSync(join(process.cwd(), "supabase/seeds", seed!), "utf8");
    expect(text).toContain("Refusing to seed dev data");
    for (const table of ["tool_access_grants", "tool_interest", "tool_events"]) {
      expect(text).toContain(`insert into public.${table}`);
    }
    expect(text).not.toMatch(/password/i);
  });
});
