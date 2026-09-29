import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Migration 0127 (TODO 3.14b): every user-media URL column holds only our
// storage objects in the writer's own folder (a built-in image, a Scryfall
// deck image where the product stores one); signup metadata can't smuggle an
// avatar in; uploads are rate-limited per user.
//
// This pins the SQL's shape. Its behaviour — 84 per-column cases (own folder
// ok, another user's folder / an outside host / a wrong bucket / a traversal
// refused, keep and clear ok, the service role unrestricted, anon refused),
// the signup sanitizer and the limiter (30 pass, the 31st is refused and not
// counted, the day cap, admins exempt, the API roles locked out, account
// deletion cascades) — was run against a scratch Postgres built from the
// Supabase image; 44 of those cases fail on the schema without 0127. The
// e2e spec tests/e2e/media-url-guards.spec.ts proves it on the CI stack with
// a real signed-in session.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const FILE = "0127_media_url_guards.sql";
const raw = readFileSync(join(dir, FILE), "utf8");
const sql = raw
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");
const flat = (text: string) => text.replace(/\s+/g, " ").trim();

/** The body of `create or replace function public.<name>(` … `$$;`. */
const fnBody = (name: string) =>
  flat(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`).exec(sql)?.[0] ?? "");

/** Every `;`-terminated statement outside function bodies. */
const statements = sql
  .replace(/as \$\$[\s\S]*?\$\$;/g, "as $$ … $$;")
  .split(";")
  .map(flat)
  .filter(Boolean);

const GUARDS = [
  {
    fn: "guard_card_media_columns",
    trigger: "cards_guard_media_columns",
    table: "public.cards",
    columns: "art_url, back_face, watermark, set_icon_url",
    checks: [
      "public.media_url_change_allowed('card-art', v_old_art, new.art_url)",
      "public.media_url_change_allowed('card-art', v_old_back_art, new.back_face ->> 'art_url')",
      "public.media_url_change_allowed('watermark', v_old_watermark, new.watermark ->> 'url')",
      "public.media_url_change_allowed('set-icon', v_old_icon, new.set_icon_url)",
    ],
  },
  {
    fn: "guard_profile_media_columns",
    trigger: "profiles_guard_media_columns",
    table: "public.profiles",
    columns: "avatar_url, banner_url",
    checks: [
      "public.media_url_change_allowed('avatar', v_old_avatar, new.avatar_url)",
      "public.media_url_change_allowed('banner', v_old_banner, new.banner_url)",
    ],
  },
  {
    fn: "guard_deck_media_columns",
    trigger: "decks_guard_media_columns",
    table: "public.decks",
    columns: "cover_url",
    checks: ["public.media_url_change_allowed('deck-cover', v_old_cover, new.cover_url)"],
  },
  {
    fn: "guard_custom_pip_media_columns",
    trigger: "custom_pips_guard_media_columns",
    table: "public.custom_pips",
    columns: "image_url",
    checks: ["public.media_url_change_allowed('pip', v_old_image, new.image_url)"],
  },
  {
    fn: "guard_deck_card_media_columns",
    trigger: "deck_cards_guard_media_columns",
    table: "public.deck_cards",
    columns: "image_url",
    checks: ["public.media_url_change_allowed('deck-card-image', v_old_image, new.image_url)"],
  },
];

describe(`${FILE} — the guard triggers`, () => {
  it.each(GUARDS)("$trigger fires on INSERT and on UPDATE of exactly $columns", (g) => {
    expect(statements).toContain(`drop trigger if exists ${g.trigger} on ${g.table}`);
    expect(statements).toContain(
      `create trigger ${g.trigger} before insert or update of ${g.columns} on ${g.table} for each row execute function public.${g.fn}()`,
    );
  });

  it.each(GUARDS)("$fn: invoker, checks only anon / authenticated, refuses with 42501 media_url_not_allowed", (g) => {
    const fn = fnBody(g.fn);
    expect(fn).toMatch(/returns trigger language plpgsql set search_path = ''/);
    // SECURITY INVOKER (the default) on purpose: current_user is the caller.
    expect(fn).not.toMatch(/security definer/i);
    expect(fn).toMatch(/if current_user not in \('anon', 'authenticated'\) then return new; end if;/);
    // OLD is read only on UPDATE (an INSERT has nothing to keep).
    expect(fn).toMatch(/if tg_op = 'UPDATE' then v_old_/);
    for (const check of g.checks) expect(fn).toContain(`if not ${check} then raise exception 'media_url_not_allowed: `);
    expect(fn.match(/using errcode = 'insufficient_privilege'/g)).toHaveLength(g.checks.length);
    expect(statements).toContain(`revoke all on function public.${g.fn}() from public, anon, authenticated`);
  });

  it("the profiles guard sorts after 0095's default-media trigger (a new profile is checked with its pair dealt)", () => {
    expect("profiles_guard_media_columns" > "profiles_assign_default_media").toBe(true);
  });

  it("a change is fine when empty, unchanged, or allowed for auth.uid()", () => {
    const fn = fnBody("media_url_change_allowed");
    expect(fn).toMatch(/language sql stable set search_path = ''/);
    expect(fn).toContain(
      "select p_new is null or p_new = '' or p_new is not distinct from p_old or public.media_url_allowed(p_kind, p_new, auth.uid());",
    );
  });

  it("media_url_allowed: a public object on a listed origin, the kind's bucket, the owner's folder, a plain name", () => {
    const fn = fnBody("media_url_allowed");
    expect(fn).toMatch(/language plpgsql stable set search_path = ''/);
    expect(fn).not.toMatch(/security definer/i);
    expect(fn).toContain(
      String.raw`'^(https?://[a-z0-9.-]+(?::[0-9]{1,5})?)/storage/v1/object/public/([a-z-]+)/([0-9a-f-]{36})/([A-Za-z0-9][A-Za-z0-9._-]{0,199})(?:\?v=[0-9]{1,20})?$'`,
    );
    expect(fn).toContain("v_parts[2] = any (v_buckets)");
    expect(fn).toContain("v_parts[3] = p_owner::text");
    expect(fn).toContain("position('..' in v_parts[4]) = 0");
    expect(fn).toContain("from public.storage_origins as o where o.origin = v_parts[1]");
    // A wildcard origin matches exactly one DNS label.
    expect(fn).toContain(String.raw`replace(replace(o.origin, '.', '\.'), '*', '[a-z0-9-]+')`);
    expect(fn).toContain("if v_buckets is null or p_owner is null then return false;");
  });

  it("rewrites no existing row (grandfathered: the triggers check changes only)", () => {
    expect(statements.filter((s) => /^(update|delete)\b/i.test(s))).toEqual([]);
  });
});

describe(`${FILE} — our storage origins`, () => {
  it("lists production's and the dev branch's origins only — never loopback or a wildcard", () => {
    const insert = statements.find((s) => s.startsWith("insert into public.storage_origins"))!;
    const origins = [...insert.matchAll(/\('([^']+)',/g)].map((m) => m[1]);
    expect(origins).toEqual([
      "https://auth.pipglyph.com",
      "https://zkwkisxoqdhdchqyjwdc.supabase.co",
      "https://znipzaxgpaiandwiqabn.supabase.co",
    ]);
    expect(insert).toMatch(/on conflict \(origin\) do nothing$/);
  });

  it("the table is read-only to the API roles", () => {
    expect(statements).toContain(
      "create policy \"Storage origins are readable by everyone\" on public.storage_origins for select using (true)",
    );
    expect(statements.filter((s) => s.startsWith("create policy"))).toHaveLength(1);
    expect(statements).toContain("revoke all on table public.storage_origins from public, anon, authenticated");
    expect(statements).toContain("grant select on table public.storage_origins to anon, authenticated");
  });

  it("supabase/seed.sql (never production) adds the preview-branch wildcard and the local stack", () => {
    const seed = readFileSync(join(process.cwd(), "supabase/seed.sql"), "utf8");
    const block = seed.slice(seed.indexOf("insert into public.storage_origins"));
    for (const origin of ["https://*.supabase.co", "http://127.0.0.1:54321", "http://localhost:54321"]) {
      expect(block).toContain(`('${origin}',`);
    }
    expect(block).toMatch(/on conflict \(origin\) do nothing;/);
  });

  it("every origin the app mints on is one the database accepts", async () => {
    const { LEGACY_SUPABASE_HOSTS } = await import("@/lib/media/storage-hosts");
    for (const host of LEGACY_SUPABASE_HOSTS) expect(raw).toContain(`'https://${host}'`);
  });
});

describe(`${FILE} — signup metadata`, () => {
  it("handle_new_user is 0094's function with the avatar sanitised and nothing else changed", () => {
    const m0094 = readFileSync(join(dir, "0094_required_unique_usernames.sql"), "utf8");
    const body = (text: string) =>
      flat(
        (/create or replace function public\.handle_new_user\(\)[\s\S]*?\$\$;/.exec(text)?.[0] ?? "")
          .split("\n")
          .filter((line) => !line.trim().startsWith("--"))
          .join("\n"),
      );
    const before = body(m0094);
    const after = body(raw);
    const sanitise = String.raw`if meta_avatar is not null and meta_avatar !~ '^https://lh[0-9]{1,2}\.googleusercontent\.com/[A-Za-z0-9_./=-]+$' then meta_avatar := null; end if;`;
    expect(after).toContain(sanitise);
    expect(after.replace(`${sanitise} `, "")).toBe(before);
    expect(after).toMatch(/security definer set search_path = public/);
    expect(statements).toContain("revoke execute on function public.handle_new_user() from public, anon, authenticated");
  });
});

describe(`${FILE} — the upload rate limit`, () => {
  it("counts minute windows per user, cascading with the account", () => {
    const create = statements.find((s) => s.startsWith("create table if not exists public.upload_hits"))!;
    expect(create).toContain("user_id uuid not null references auth.users (id) on delete cascade");
    expect(create).toContain("primary key (user_id, window_start)");
    expect(statements).toContain("alter table public.upload_hits enable row level security");
    expect(statements.some((s) => s.startsWith("create policy") && s.includes("upload_hits"))).toBe(false);
  });

  it("hit_upload_limit: admins exempt from the database's own flag, a per-user lock, a day's windows, refusals uncounted", () => {
    const fn = fnBody("hit_upload_limit");
    expect(fn).toContain("returns table (allowed boolean, retry_after_seconds integer, limited_by text)");
    expect(fn).toMatch(/security invoker set search_path = public/);
    expect(fn).toContain(
      "if exists (select 1 from public.profiles as p where p.id = p_user_id and p.is_admin) then return query select true, 0, null::text; return; end if;",
    );
    expect(fn).toContain("perform pg_advisory_xact_lock(hashtextextended('upload_hits:' || p_user_id::text, 0));");
    expect(fn).toContain("delete from public.upload_hits as h where h.window_start <= v_window - interval '1 day';");
    // Both refusals return before the insert (a refused call isn't counted).
    const insertAt = fn.indexOf("insert into public.upload_hits");
    expect(fn.indexOf("'minute'::text")).toBeLessThan(insertAt);
    expect(fn.indexOf("'day'::text")).toBeLessThan(insertAt);
    // The admin check comes before the lock and the count.
    expect(fn.indexOf("p.is_admin")).toBeLessThan(fn.indexOf("pg_advisory_xact_lock"));
  });

  it("is service-role only", () => {
    expect(statements).toContain("revoke all on table public.upload_hits from public, anon, authenticated");
    expect(statements).toContain("grant select, insert, update, delete on table public.upload_hits to service_role");
    expect(statements).toContain(
      "revoke all on function public.hit_upload_limit(uuid, integer, integer) from public, anon, authenticated",
    );
    expect(statements).toContain("grant execute on function public.hit_upload_limit(uuid, integer, integer) to service_role");
  });
});

describe(`${FILE} — grants`, () => {
  it("states every grant, and none is a blanket grant", () => {
    const privileges = statements.filter((s) => /^(grant|revoke)\b/i.test(s));
    expect(privileges).toEqual([
      "revoke all on table public.storage_origins from public, anon, authenticated",
      "grant select on table public.storage_origins to anon, authenticated",
      "grant select, insert, update, delete on table public.storage_origins to service_role",
      "revoke all on function public.media_url_allowed(text, text, uuid) from public",
      "grant execute on function public.media_url_allowed(text, text, uuid) to anon, authenticated, service_role",
      "revoke all on function public.media_url_change_allowed(text, text, text) from public",
      "grant execute on function public.media_url_change_allowed(text, text, text) to anon, authenticated, service_role",
      "revoke all on function public.guard_card_media_columns() from public, anon, authenticated",
      "revoke all on function public.guard_profile_media_columns() from public, anon, authenticated",
      "revoke all on function public.guard_deck_media_columns() from public, anon, authenticated",
      "revoke all on function public.guard_custom_pip_media_columns() from public, anon, authenticated",
      "revoke all on function public.guard_deck_card_media_columns() from public, anon, authenticated",
      "revoke execute on function public.handle_new_user() from public, anon, authenticated",
      "revoke all on table public.upload_hits from public, anon, authenticated",
      "grant select, insert, update, delete on table public.upload_hits to service_role",
      "revoke all on function public.hit_upload_limit(uuid, integer, integer) from public, anon, authenticated",
      "grant execute on function public.hit_upload_limit(uuid, integer, integer) to service_role",
    ]);
    expect(flat(sql)).not.toMatch(/\bon all (tables|functions)\b/i);
  });

  it("says so in the header", () => {
    expect(raw).toMatch(/^-- Grants \(every migration states them; never a blanket grant\):$/m);
  });
});
