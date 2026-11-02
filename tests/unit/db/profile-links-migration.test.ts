import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LINK_KINDS, PROFILE_LINKS_MAX, PROFILE_LINK_LABEL_MAX } from "@/lib/profile/link-kinds";
import { PROFILE_STORES_MAX, STORE_PLATFORMS, STORE_TITLE_MAX } from "@/lib/profile/store-platforms";
import { TYPED_FORMS } from "@/lib/validation/typed-forms";

// ---------------------------------------------------------------------------
// Migration 0159 (profile links, store cards, the profile card search) holds
// the same lists, caps and fold as the app: a kind or platform added to a
// registry without the CHECK fails every save with a 23514, and a fold that
// drifts from typedForMatching's table misses "Urza’s" for "Urza's".
// ---------------------------------------------------------------------------

const sql = readFileSync(join(process.cwd(), "supabase/migrations/0159_profile_links.sql"), "utf8")
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

function checkList(constraint: string): string[] {
  const at = sql.indexOf(`constraint ${constraint} check (`);
  expect(at, constraint).toBeGreaterThan(-1);
  const body = sql.slice(at, sql.indexOf("))", at));
  return [...body.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
}

describe("migration 0159", () => {
  it("lists exactly the link kinds of lib/profile/link-kinds.ts", () => {
    expect(checkList("profile_links_kind").sort()).toEqual(LINK_KINDS.map((k) => k.key).sort());
  });

  it("lists exactly the store platforms of lib/profile/store-platforms.ts", () => {
    expect(checkList("profile_stores_platform").sort()).toEqual(STORE_PLATFORMS.map((p) => p.key).sort());
  });

  it("caps rows and texts where the app does", () => {
    expect(sql).toMatch(new RegExp(`then ${PROFILE_STORES_MAX} else ${PROFILE_LINKS_MAX} end`));
    expect(sql).toContain(`char_length(label) between 1 and ${PROFILE_LINK_LABEL_MAX}`);
    expect(sql).toContain(`char_length(title) between 1 and ${STORE_TITLE_MAX}`);
    expect(sql).toMatch(/url ~ '\^https:\/\//);
  });

  it("is public-read, owner-write, with RLS on and its grants stated", () => {
    for (const table of ["profile_links", "profile_stores"]) {
      expect(sql).toContain(`alter table public.${table} enable row level security;`);
    }
    expect(sql).toMatch(/for select\s+using \(true\)/);
    expect((sql.match(/owner_id = auth\.uid\(\)/g) ?? []).length).toBeGreaterThanOrEqual(8);
    expect(sql).toContain("grant select on table public.profile_links, public.profile_stores to anon;");
    expect(sql).toContain(
      "grant select, insert, update, delete on table public.profile_links, public.profile_stores to authenticated;",
    );
    // The setters are the signed-in user's only; neither is anon's.
    expect(sql).toMatch(/grant execute on function public\.set_profile_links\(jsonb\) to authenticated, service_role;/);
    expect(sql).not.toMatch(/set_profile_(links|stores)\(jsonb\) to anon/);
    // 0155 / 0156's pattern: what prod's old project auto-granted is revoked
    // before the explicit grants, so prod and a new branch agree.
    expect(sql.indexOf("revoke all on table public.profile_links, public.profile_stores from public, anon, authenticated;"))
      .toBeLessThan(sql.indexOf("grant select on table public.profile_links, public.profile_stores to anon;"));
    expect(sql).toContain("revoke all on function public.set_profile_links(jsonb) from public, anon;");
    expect(sql).toContain("revoke all on function public.set_profile_stores(jsonb) from public, anon;");
    // No API role executes the cap's trigger function.
    expect(sql).toContain("revoke all on function public.profile_links_enforce_cap() from public, anon, authenticated, service_role;");
    expect(sql).not.toMatch(/grant [^;]*profile_links_enforce_cap/);
    // Nothing runs SECURITY DEFINER: RLS decides every read and write.
    expect(sql).not.toMatch(/security definer/i);
  });

  it("folds the card search with typedForMatching's table, on the query, the title and the nickname", () => {
    const folds = [...sql.matchAll(/'([’‘“”—–]+)', '((?:''|[^'])+)'\)/g)].map(
      (m) => [m[1], m[2].replace(/''/g, "'")] as const,
    );
    expect(folds).toHaveLength(3);
    for (const [from, to] of folds) {
      expect(Object.fromEntries([...from].map((ch, i) => [ch, [...to][i]]))).toEqual({ ...TYPED_FORMS });
    }
    expect(sql).toMatch(/translate\(c\.title,/);
    expect(sql).toMatch(/translate\(coalesce\(c\.nickname, ''\),/);
    // Public cards only (unlisted is link-only).
    expect(sql).toContain("and c.visibility = 'public'");
  });
});

describe("seeds/33_profile_links.sql", () => {
  const seed = readFileSync(join(process.cwd(), "supabase/seeds/33_profile_links.sql"), "utf8");
  const rows = [...seed.matchAll(/'d0000000-[^']+'::uuid, '([a-z]+)', '([^']+)'/g)].map((m) => [m[1], m[2]] as const);

  it("seeds links and stores the profile will draw", async () => {
    const { drawableProfileLinks } = await import("@/lib/profile/link-kinds");
    const { drawableProfileStores } = await import("@/lib/profile/store-platforms");
    expect(rows.length).toBeGreaterThanOrEqual(10);
    const links = seed.slice(0, seed.indexOf("insert into public.profile_stores"));
    for (const [key, url] of rows) {
      const row = links.includes(`'${url}'`)
        ? drawableProfileLinks([{ kind: key, url }])
        : drawableProfileStores([{ platform: key, url, title: null }]);
      expect(row, `${key} ${url}`).toHaveLength(1);
    }
  });

  it("seeds a user's rows only while that user has none (a re-seed never stacks rows or trips the cap)", () => {
    expect(seed).toMatch(/and not exists \(select 1 from public\.profile_links where owner_id = l\.owner_id\)/);
    expect(seed).toMatch(/and not exists \(select 1 from public\.profile_stores where owner_id = s\.owner_id\)/);
  });
});
