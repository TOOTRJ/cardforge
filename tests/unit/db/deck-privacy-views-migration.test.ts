import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DECK_LINK_HEADER } from "@/lib/decks/deck-link";
import { PRIVATE_CARD_NAME } from "@/lib/decks/private-card-name";
import { TYPED_FORMS } from "@/lib/validation/typed-forms";
import { DECK_VIEW_RETENTION_DAYS } from "@/app/api/cron/prune-funnel-events/route";

// ---------------------------------------------------------------------------
// 0151 — the API hands out what the deck page shows (TODO DK0.11). What the
// SQL itself must keep, held to the app's constants (its behaviour — link-only
// unlisted decks, the guide read and its redaction, the deduped views, the
// owner's read, the grants, the cascades and every current read path before /
// after — is proved on the local stack in ONE rolled-back transaction, PR
// body):
//   * ONE rule for "may this request read the deck": the decks policy —
//     public, the owner's, or an unlisted deck the request names by its slug
//     or id in the app's header (lib/decks/deck-link.ts); the entries' and
//     likes' reads ask that policy (`exists (select 1 from decks …)`), never a
//     restated visibility list;
//   * guides: no table policy and no API grant — ONE definer function reads
//     them, its Pro rule is lib/billing/entitlements.ts's, its redaction
//     writes the deck page's "Private card";
//   * views: the counter grows only through record_deck_view, the service
//     role's alone; increment_deck_view is gone (and no app code calls it);
//     the owner's read spans the prune cron's retention.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const strip = (sql: string) =>
  sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const SQL = strip(readFileSync(join(dir, "0151_deck_privacy_and_views.sql"), "utf8"));
const FLAT = squash(SQL);

/** The body of `create or replace function public.<name>(` … `$$;`. */
function fnBody(name: string): string {
  const start = SQL.indexOf(`create or replace function public.${name}(`);
  if (start < 0) throw new Error(`no function ${name}`);
  const open = SQL.indexOf("$$", start);
  const close = SQL.indexOf("$$", open + 2);
  return squash(SQL.slice(open + 2, close));
}

/** The header of a function: everything from `create` to its body. */
function fnHead(name: string): string {
  const start = SQL.indexOf(`create or replace function public.${name}(`);
  return squash(SQL.slice(start, SQL.indexOf("$$", start)));
}

/** The USING clause of `create policy "<name>"`. */
function policyUsing(name: string): string {
  const start = SQL.indexOf(`create policy "${name}"`);
  if (start < 0) throw new Error(`no policy ${name}`);
  const end = SQL.indexOf(";", start);
  return squash(SQL.slice(start, end));
}

describe("0151: an unlisted deck is read by its link only", () => {
  it("reads the app's header, lower-cased as PostgREST hands it over", () => {
    expect(DECK_LINK_HEADER).toBe(DECK_LINK_HEADER.toLowerCase());
    expect(fnBody("requested_deck_link")).toContain(`->> '${DECK_LINK_HEADER}'`);
    expect(fnBody("requested_deck_link")).toContain("current_setting('request.headers', true)");
  });

  it("the decks policy: public, the owner's, or the unlisted deck the request names", () => {
    const using = policyUsing("Decks: public, the owner's, and an unlisted one by its link");
    expect(using).toContain("for select");
    expect(using).toContain("visibility = 'public'");
    expect(using).toContain("auth.uid() = owner_id");
    expect(using).toContain("visibility = 'unlisted' and (select public.requested_deck_link()) in (slug, id::text)");
    // 0055's "public or unlisted" rule is dropped, not left beside it.
    expect(FLAT).toContain(`drop policy if exists "Decks: public + unlisted readable, private by owner" on public.decks;`);
    expect(using).not.toContain("in ('public', 'unlisted')");
  });

  it("the entries and likes ask the decks policy — never a visibility list of their own", () => {
    for (const name of ["Deck cards: visible when parent deck is readable", "Deck likes are readable when their deck is visible"]) {
      const using = policyUsing(name);
      expect(using).toContain("exists (select 1 from public.decks d where d.id = deck_id)");
      expect(using).not.toMatch(/visibility/);
    }
    expect(policyUsing("Deck likes are readable when their deck is visible")).toContain("user_id = auth.uid()");
  });

  it("every role may call the header reader (the policy runs it for anon too)", () => {
    expect(FLAT).toContain("grant execute on function public.requested_deck_link() to anon, authenticated, service_role;");
  });
});

describe("0151: a deck guide is read where the page shows it", () => {
  it("no API role reads the table; ONE definer function does", () => {
    expect(FLAT).toContain(`drop policy if exists "Deck guides follow their deck's visibility" on public.deck_guides;`);
    expect(SQL).not.toMatch(/create policy[^;]*on public\.deck_guides/);
    expect(FLAT).toContain("revoke all on table public.deck_guides from anon, authenticated;");
    expect(fnHead("deck_guide_for_viewer")).toContain("security definer set search_path = ''");
    expect(FLAT).toContain("grant execute on function public.deck_guide_for_viewer(uuid) to anon, authenticated, service_role;");
  });

  it("opens the decks the page opens: public, unlisted by its id, or the caller's own", () => {
    expect(fnBody("deck_guide_for_viewer")).toContain(
      "where d.id = p_deck_id and (d.visibility in ('public', 'unlisted') or d.owner_id = auth.uid())",
    );
  });

  it("its Pro rule is entitlements.ts's: an admin, an active / trialing Pro plan, an unexpired Pro comp", () => {
    const entitlements = readFileSync(join(process.cwd(), "lib/billing/entitlements.ts"), "utf8");
    expect(entitlements).toContain('const ACTIVE_STATUSES = new Set(["active", "trialing"]);');
    expect(entitlements).toContain("if (profile?.is_admin) return UNLOCKED;");
    expect(squash(entitlements)).toContain(
      "(profile.comp_expires_at == null || new Date(profile.comp_expires_at) > new Date())",
    );
    const pro = fnBody("viewer_is_pro");
    expect(pro).toContain("p.is_admin");
    expect(pro).toContain("(p.subscription_tier = 'pro' and p.subscription_status in ('active', 'trialing'))");
    expect(pro).toContain("(p.comp_tier = 'pro' and (p.comp_expires_at is null or p.comp_expires_at > now()))");
    expect(pro).toContain("where p.id = auth.uid()");
    expect(FLAT).toContain("revoke all on function public.viewer_is_pro() from public, anon, authenticated;");
  });

  it("the text only for Pro, as stored for the owner, redacted for anyone else", () => {
    const body = fnBody("deck_guide_for_viewer");
    for (const field of ["overview", "mulligan", "weaknesses"]) {
      expect(body).toContain(
        `case when not access.can_read then null when deck.is_owner then g.${field} else public.redact_guide_text(g.${field}, redaction.pattern, redaction.map) end`,
      );
    }
    for (const field of ["game_plan", "combos", "key_cards"]) {
      expect(body).toContain(
        `case when not access.can_read then null when deck.is_owner then g.${field} else public.redact_guide_jsonb(g.${field}, redaction.pattern, redaction.map) end`,
      );
    }
  });

  it("past 150 hidden names (or 400 in all) a visitor gets the teaser — the owner still reads", () => {
    const body = fnBody("deck_guide_for_viewer");
    expect(body).toContain(
      "select viewer.pro and (deck.is_owner or (scrub.hidden_count <= 150 and scrub.name_count <= 400)) as can_read",
    );
    // The pattern and the map are built only for a guide that will be read.
    expect(body.match(/when scrub\.hidden_count between 1 and 150 and scrub\.name_count <= 400 then/g)).toHaveLength(2);
  });

  it("hides the cards the deck read hides (canLinkIntoDeck + the cards' RLS), as the list names them", () => {
    const body = fnBody("deck_guide_for_viewer");
    expect(body).toContain(
      "c.id is not null and not (c.visibility = 'public' or (c.visibility = 'unlisted' and c.owner_id = deck.owner_id)) as hidden",
    );
    // A printing's real name, else the deck page's own words.
    expect(body).toContain(`case when entries.printed then entries.entry_name else '${PRIVATE_CARD_NAME}' end as sub`);
    // Longest first, so a full name goes before its short form; the
    // guards (shown names a hidden one, or its plural, sits inside as words)
    // in the same list; the map keyed by the one fold.
    expect(body).toContain("public.guide_redaction_pattern( (select array_agg(n.name order by char_length(n.name) desc, n.name) from names n))");
    expect(body).toContain("(select jsonb_object_agg(public.guide_name_fold(btrim(n.name)), n.sub) from names n)");
    expect(body).toContain("where position(' ' || h.words || ' ' in s.words) > 0");
    // A name with no letter or digit is never one ("--" took every dash).
    expect(body).toContain("and n.name ~ '[[:alnum:]]'");
    // Every comparison of two names goes through the one fold.
    expect(body).toContain("not exists (select 1 from shown s where s.key = public.guide_name_fold(ws.name))");
    expect(body).not.toMatch(/lower\(ws\.name\)|lower\(entry_name\)/);
  });

  it("folds the printed quotes and dashes as typedForMatching does (0136's six), plus ʼ", () => {
    const fold = fnBody("guide_name_fold");
    const [src, dst] = [...fold.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'")).slice(0, 2);
    expect(src.length).toBe(dst.length);
    for (const [printed, typed] of Object.entries(TYPED_FORMS)) {
      const at = src.indexOf(printed);
      expect(at, printed).toBeGreaterThanOrEqual(0);
      expect(dst[at], printed).toBe(typed);
    }
    expect(dst[src.indexOf("ʼ")]).toBe("'");
    // Each pattern class is the fold's own letters, so a match folds alike.
    const pattern = fnBody("guide_name_pattern");
    for (const letter of new Set(dst)) {
      if (!/[a-z]/.test(letter)) continue;
      const variants = [...src].filter((_, i) => dst[i] === letter).join("");
      expect(pattern, letter).toContain(`when v_ch = '${letter}' then '[${letter}${letter.toUpperCase()}${variants}]'`);
    }
  });

  it("ONE pass of ONE pattern built once per guide; each match named by its fold", () => {
    const body = fnBody("redact_guide_text");
    expect(body).toContain("v_parts := regexp_split_to_array(p_text, p_pattern, 'i');");
    expect(body).toContain("from regexp_matches(p_text, p_pattern, 'gi')");
    expect(body).not.toContain("regexp_replace");
    // No pattern is built here, and no regex per name per match.
    expect(body).not.toContain("guide_name_pattern");
    expect(body).not.toContain("~*");
    // The fold names the match; one the map can't name reads the deck
    // page's words (fail closed); a guard (JSON null) is kept as written.
    expect(body).toContain("v_key := public.guide_name_fold(v_hit[1]);");
    expect(body).toContain(`v_sub := case when p_map ? v_key then p_map ->> v_key else '${PRIVATE_CARD_NAME}' end;`);
    expect(body).toContain("case when v_sub is null then v_hit[1] || v_hit[2] else v_sub || lower(v_hit[2]) end");
    expect(fnBody("guide_redaction_pattern")).toContain("|| ')((?:e?s)?)(?![[:alnum:]_])'");
  });

  it("an ae / oe / ss pair is matched from its letters' classes (Zoë, Noël, Citroën), or its one letter", () => {
    const pattern = fnBody("guide_name_pattern");
    const cls = (letter: string) => pattern.match(new RegExp(`when v_ch = '${letter}' then '(\\[[^']+\\])'`))?.[1];
    const [a, e, o, s] = ["a", "e", "o", "s"].map(cls);
    expect([a, e, o, s].every(Boolean)).toBe(true);
    expect(pattern).toContain(`when 'ae' then '(?:${a}${e}|æ|Æ)'`);
    expect(pattern).toContain(`when 'oe' then '(?:${o}${e}|œ|Œ)'`);
    expect(pattern).toContain(`else '(?:${s}${s}|ß)'`);
  });

  it("the helpers are the service role's; nothing else may call them", () => {
    expect(FLAT).toContain("revoke all on function public.redact_guide_text(text, text, jsonb) from public, anon, authenticated;");
    expect(FLAT).toContain("revoke all on function public.redact_guide_jsonb(jsonb, text, jsonb) from public, anon, authenticated;");
    expect(FLAT).toContain("revoke all on function public.guide_redaction_pattern(text[]) from public, anon, authenticated;");
    expect(FLAT).toContain("revoke all on function public.guide_words(text) from public, anon, authenticated;");
    expect(FLAT).toContain("revoke all on function public.guide_name_fold(text) from public, anon, authenticated;");
    expect(FLAT).toContain("revoke all on function public.guide_name_pattern(text) from public, anon, authenticated;");
  });
});

describe("0151: views — one per viewer, deck and day", () => {
  it("the counter grows only through record_deck_view, the service role's alone", () => {
    const body = fnBody("record_deck_view");
    expect(body).toContain("on conflict do nothing; if not found then return false;");
    expect(body).toContain("update public.decks set view_count = view_count + 1 where id = p_deck_id;");
    expect(body).toContain("and d.visibility in ('public', 'unlisted') and d.owner_id is distinct from p_viewer_id");
    expect(body).toContain("p_viewer !~ '^[0-9a-f]{32}$'");
    expect(FLAT).toContain("revoke all on function public.record_deck_view(uuid, text, uuid) from public, anon, authenticated;");
    expect(FLAT).toContain("grant execute on function public.record_deck_view(uuid, text, uuid) to service_role;");
    expect(FLAT).toContain("drop function if exists public.increment_deck_view(uuid);");
  });

  it("keys a row by the day's salt and drops every older one — core functions only", () => {
    const body = fnBody("record_deck_view");
    expect(body).toContain("delete from public.deck_view_salts s where s.day < v_day;");
    expect(body).toContain("sha256(v_salt || convert_to(p_deck_id::text || ':' || p_viewer, 'UTF8'))");
    // No extension: a project with pgcrypto elsewhere (or none) works alike.
    expect(SQL).not.toMatch(/extensions\.|pgcrypto|gen_random_bytes|hmac\(/);
  });

  it("no API role touches the log or the salts", () => {
    for (const table of ["deck_views", "deck_view_salts"]) {
      expect(FLAT).toContain(`alter table public.${table} enable row level security;`);
      expect(FLAT).toContain(`revoke all on table public.${table} from public, anon, authenticated;`);
      expect(SQL).not.toMatch(new RegExp(`create policy[^;]*on public\\.${table}\\b`));
    }
  });

  it("the owner's read is the owner's, and reaches as far back as the prune keeps", () => {
    const body = fnBody("deck_views_by_day");
    expect(body).toContain("where d.id = p_deck_id and d.owner_id = auth.uid()");
    expect(body).toContain(`least(greatest(coalesce(p_days, 30), 1), ${DECK_VIEW_RETENTION_DAYS})`);
    expect(FLAT).toContain("revoke all on function public.deck_views_by_day(uuid, integer) from public, anon;");
    expect(FLAT).toContain("grant execute on function public.deck_views_by_day(uuid, integer) to authenticated, service_role;");
  });

  it("no app code calls increment_deck_view but the pre-0151 fallback (lib/decks/views.ts)", () => {
    const hits: string[] = [];
    const walk = (path: string) => {
      for (const name of readdirSync(path)) {
        const full = join(path, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx|mjs)$/.test(name) && readFileSync(full, "utf8").includes("increment_deck_view")) hits.push(full);
      }
    };
    for (const root of ["app", "lib", "components", "scripts"]) walk(join(process.cwd(), root));
    expect(hits.map((f) => f.slice(process.cwd().length + 1))).toEqual(["lib/decks/views.ts"]);
    // …and only on PGRST202, the code PostgREST gives a missing function.
    const views = readFileSync(join(process.cwd(), "lib/decks/views.ts"), "utf8");
    expect(views).toContain('if (error?.code === "PGRST202") {');
  });
});
