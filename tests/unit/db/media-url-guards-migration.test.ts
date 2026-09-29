import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Migration 0127 (TODO 3.14b): every user-media URL column holds only our
// storage objects in the writer's own folder (a built-in image, a Scryfall
// deck image where the product stores one); signup metadata can't smuggle an
// avatar in; uploads are rate-limited per user.
//
// This pins the SQL's shape. Its behaviour — per-column cases (own folder
// ok, another user's folder / an outside host / a wrong bucket / a traversal
// refused, keep and clear ok, the service role unrestricted, anon refused),
// the signup sanitizer, the back-face guard and the limiter (the 31st in 60
// seconds refused and not counted, the window sliding, the day cap, admins
// exempt, the prune, the API roles locked out) — is proved on the CI stack
// with a real signed-in session by tests/e2e/media-url-guards.spec.ts. (The
// first cut of the column guards also ran on a scratch Postgres from the
// Supabase image: 89 per-column cases, 44 failing without 0127.)
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
    // Exact origins only — no wildcard matching (review 2026-09-29).
    expect(fn).toContain("from public.storage_origins as o where o.origin = v_parts[1] );");
    expect(fn).not.toMatch(/like '%:\/\/\*|replace\(/);
    expect(fn).toContain("if v_buckets is null or p_owner is null then return false;");
  });

  it("rewrites no existing row (grandfathered: the triggers check changes only)", () => {
    expect(statements.filter((s) => /^(update|delete)\b/i.test(s))).toEqual([]);
  });
});

describe(`${FILE} — our storage origins`, () => {
  it("lists production's two origins only — no other environment's host, no loopback, no wildcard", () => {
    // The migration runs on EVERY database, production included: anything
    // listed here production trusts too (review 2026-09-29 — the dev
    // branch's host was listed). Other databases get their own origin from
    // the app (lib/media/storage-origin.ts).
    const inserts = statements.filter((s) => s.startsWith("insert into public.storage_origins"));
    expect(inserts).toHaveLength(1);
    const origins = [...inserts[0].matchAll(/\('([^']+)',/g)].map((m) => m[1]);
    expect(origins).toEqual(["https://auth.pipglyph.com", "https://zkwkisxoqdhdchqyjwdc.supabase.co"]);
    expect(raw).not.toContain("znipzaxgpaiandwiqabn");
    expect(inserts[0]).toMatch(/on conflict \(origin\) do nothing$/);
  });

  it("its CHECK takes one exact http(s) origin per row — a wildcard can't even be stored", () => {
    const create = statements.find((s) => s.startsWith("create table if not exists public.storage_origins"))!;
    const check = /check \(origin ~ '([^']+)'\)/.exec(create)![1];
    expect(check).toBe(String.raw`^https?://[a-z0-9.-]+(:[0-9]{1,5})?$`);
    const re = new RegExp(check);
    for (const ok of ["https://auth.pipglyph.com", "http://127.0.0.1:54321", "https://abcdefghij.supabase.co"]) expect(re.test(ok), ok).toBe(true);
    for (const bad of ["https://*.supabase.co", "https://auth.pipglyph.com/", "https://Auth.pipglyph.com", "ftp://x.test"]) expect(re.test(bad), bad).toBe(false);
  });

  it("the table is read-only to the API roles", () => {
    expect(statements).toContain(
      "create policy \"Storage origins are readable by everyone\" on public.storage_origins for select using (true)",
    );
    expect(statements.filter((s) => s.startsWith("create policy"))).toHaveLength(1);
    expect(statements).toContain("revoke all on table public.storage_origins from public, anon, authenticated");
    expect(statements).toContain("grant select on table public.storage_origins to anon, authenticated");
  });

  it("no seed lists an origin — above all no `*.supabase.co` wildcard (any project's storage, an attacker's included)", () => {
    const seeds = [join(process.cwd(), "supabase/seed.sql")];
    const seedDir = join(process.cwd(), "supabase/seeds");
    for (const f of readdirSync(seedDir)) if (f.endsWith(".sql")) seeds.push(join(seedDir, f));
    for (const file of seeds) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/storage_origins/);
      expect(text, file).not.toContain("*.supabase.co");
    }
  });

  it("every origin the app mints on is one the database accepts", async () => {
    const { LEGACY_SUPABASE_HOSTS } = await import("@/lib/media/storage-hosts");
    for (const host of LEGACY_SUPABASE_HOSTS) expect(raw).toContain(`'https://${host}'`);
  });
});

describe(`${FILE} — a card's back face`, () => {
  // Review 2026-09-29: back_card_id was checked only by the app, so a PATCH
  // could point a card's flip at another user's card.
  it("cards_guard_back_card fires on INSERT and on UPDATE of back_card_id", () => {
    expect(statements).toContain("drop trigger if exists cards_guard_back_card on public.cards");
    expect(statements).toContain(
      "create trigger cards_guard_back_card before insert or update of back_card_id on public.cards for each row execute function public.guard_card_back_card()",
    );
  });

  it("anon / authenticated may keep or clear it, or name another card with the same owner — else 42501", () => {
    const fn = fnBody("guard_card_back_card");
    expect(fn).toMatch(/returns trigger language plpgsql set search_path = ''/);
    expect(fn).not.toMatch(/security definer/i);
    expect(fn).toContain("if current_user not in ('anon', 'authenticated') then return new; end if;");
    expect(fn).toContain("if tg_op = 'UPDATE' then v_old_back := old.back_card_id; end if;");
    expect(fn).toContain("if new.back_card_id is null or new.back_card_id is not distinct from v_old_back then return new; end if;");
    expect(fn).toContain(
      "if not exists ( select 1 from public.cards as c where c.id = new.back_card_id and c.id <> new.id and c.owner_id = new.owner_id ) then raise exception 'back_card_not_allowed: cards.back_card_id must be another of your own cards' using errcode = 'insufficient_privilege';",
    );
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
    // Kept only for a Google sign-in (GoTrue's raw_app_meta_data, never the
    // user's metadata) and only a Google ACCOUNT picture (review 2026-09-29:
    // any email signup could send `https://lh3.googleusercontent.com/<any
    // Google Photos image>`).
    const sanitise = String.raw`if meta_avatar is not null and (coalesce(new.raw_app_meta_data ->> 'provider', '') <> 'google' or meta_avatar !~ '^https://lh[0-9]{1,2}\.googleusercontent\.com/a-?/[A-Za-z0-9_./=-]+$') then meta_avatar := null; end if;`;
    expect(after).toContain(sanitise);
    expect(after.replace(`${sanitise} `, "")).toBe(before);
    expect(after).toMatch(/security definer set search_path = public/);
    expect(statements).toContain("revoke execute on function public.handle_new_user() from public, anon, authenticated");
  });
});

describe(`${FILE} — the upload rate limit`, () => {
  it("keeps one row per counted upload, cascading with the account", () => {
    const create = statements.find((s) => s.startsWith("create table if not exists public.upload_hits"))!;
    expect(create).toContain("user_id uuid not null references auth.users (id) on delete cascade");
    expect(create).toContain("hit_at timestamptz not null");
    expect(create).toContain("primary key (user_id, hit_at)");
    expect(statements).toContain("create index if not exists upload_hits_hit_at_idx on public.upload_hits (hit_at)");
    expect(statements).toContain("alter table public.upload_hits enable row level security");
    expect(statements.some((s) => s.startsWith("create policy") && s.includes("upload_hits"))).toBe(false);
  });

  it("hit_upload_limit: admins exempt from the database's own flag, a per-user lock, refusals uncounted", () => {
    const fn = fnBody("hit_upload_limit");
    expect(fn).toContain("returns table (allowed boolean, retry_after_seconds integer, limited_by text)");
    expect(fn).toMatch(/security invoker set search_path = public/);
    expect(fn).toContain(
      "if exists (select 1 from public.profiles as p where p.id = p_user_id and p.is_admin) then return query select true, 0, null::text; return; end if;",
    );
    expect(fn).toContain("perform pg_advisory_xact_lock(hashtextextended('upload_hits:' || p_user_id::text, 0)); v_now := clock_timestamp();");
    // Both refusals return before the insert (a refused call isn't counted).
    const insertAt = fn.indexOf("insert into public.upload_hits");
    expect(fn.indexOf("'minute'::text")).toBeLessThan(insertAt);
    expect(fn.indexOf("'day'::text")).toBeLessThan(insertAt);
    expect(fn).toContain("values (p_user_id, v_now, 1) on conflict (user_id, hit_at) do update set hits = h.hits + 1;");
    // The admin check comes before the lock and the count.
    expect(fn.indexOf("p.is_admin")).toBeLessThan(fn.indexOf("pg_advisory_xact_lock"));
  });

  it("counts SLIDING windows — the last 60 seconds and the last 24 hours — not calendar minutes", () => {
    // Calendar minutes let ~60 uploads through in two seconds across a
    // minute boundary (review 2026-09-29).
    const fn = fnBody("hit_upload_limit");
    expect(fn).not.toMatch(/date_trunc/);
    expect(fn).toContain(
      "select coalesce(sum(h.hits) filter (where h.hit_at > v_now - interval '1 minute'), 0)::integer, coalesce(sum(h.hits), 0)::integer, min(h.hit_at) filter (where h.hit_at > v_now - interval '1 minute'), min(h.hit_at) into v_minute, v_day, v_minute_oldest, v_day_oldest from public.upload_hits as h where h.user_id = p_user_id and h.hit_at > v_now - interval '1 day';",
    );
    // The wait is until the oldest hit of the full window leaves it.
    expect(fn).toContain("ceil(extract(epoch from (v_minute_oldest + interval '1 minute' - v_now)))");
    expect(fn).toContain("ceil(extract(epoch from (v_day_oldest + interval '1 day' - v_now)))");
  });

  it("prunes a bounded batch of expired rows, skipping locked ones — never a blocking every-user delete", () => {
    // Review 2026-09-29: `delete … where window_start <= …` for ALL users on
    // every call put cross-user row-lock waits on the upload path.
    const fn = fnBody("hit_upload_limit");
    expect(fn).toContain(
      "with expired as ( select h.user_id, h.hit_at from public.upload_hits as h where h.hit_at <= v_now - interval '1 day' limit 500 for update skip locked ) delete from public.upload_hits as h using expired as e where h.user_id = e.user_id and h.hit_at = e.hit_at;",
    );
    expect(fn.match(/delete from public\.upload_hits/g)).toHaveLength(1);
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
      "revoke all on function public.guard_card_back_card() from public, anon, authenticated",
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
