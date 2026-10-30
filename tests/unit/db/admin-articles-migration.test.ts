import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ARTICLE_DIAGRAM, isAllowedMediaUrl, MEDIA_KIND_BUCKETS } from "@/lib/media/media-urls";

// ---------------------------------------------------------------------------
// Migration 0153 (admin articles — a placeholder number the orchestrator
// renumbers, so it is found by name):
//   * the public reads released rows only; admins read and write everything,
//     through viewer_is_admin() (0080) — never a profiles subquery;
//   * grants stated, never a blanket grant (CLAUDE.md);
//   * the cover is a picture column under 0127's rules, and media_url_allowed
//     is 0150's word for word plus the 'article-image' kind and ONE
//     site-relative branch — the same pattern as lib/media/media-urls.ts.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const file = readdirSync(dir).find((f) => /^\d{4}_admin_articles\.sql$/.test(f))!;
const SQL = readFileSync(join(dir, file), "utf8");
const SQL_0150 = readFileSync(join(dir, readdirSync(dir).find((f) => /^0150_/.test(f))!), "utf8");
const code = (sql: string) => sql.replace(/--.*$/gm, "");
const statements = code(SQL)
  .split(";")
  .map((s) => s.replace(/\s+/g, " ").trim());
const fn = (sql: string, name: string) =>
  new RegExp(`create or replace function public\\.${name}[\\s\\S]*?\\$\\$;`).exec(sql)![0];

describe(`${file}`, () => {
  it("is the newest migration (a placeholder renumbered at merge)", () => {
    const numbers = readdirSync(dir)
      .filter((f) => /^\d{4}_.*\.sql$/.test(f))
      .map((f) => Number(f.slice(0, 4)));
    expect(Number(file.slice(0, 4))).toBe(Math.max(...numbers));
  });

  it("turns RLS on with the released-rows read and admin-only writes", () => {
    expect(SQL).toContain("alter table public.articles enable row level security;");
    expect(SQL).toMatch(/for select\s+using \(is_published and publish_at <= now\(\)\);/);
    for (const op of ["select", "insert", "update", "delete"]) {
      expect(SQL, op).toMatch(new RegExp(`for ${op}\\s+(using|with check) \\(public\\.viewer_is_admin\\(\\)\\)`));
    }
    expect(code(SQL)).not.toMatch(/from public\.profiles[^;]*is_admin[^;]*auth\.uid/);
  });

  it("states its grants", () => {
    expect(statements).toContain("revoke all on table public.articles from public, anon, authenticated");
    expect(statements).toContain("grant select on table public.articles to anon, authenticated");
    expect(statements).toContain("grant insert, update, delete on table public.articles to authenticated");
    expect(statements).toContain("grant select, insert, update, delete on table public.articles to service_role");
    expect(statements).toContain(
      "grant execute on function public.media_url_allowed(text, text, uuid) to anon, authenticated, service_role",
    );
    expect(statements).toContain(
      "revoke all on function public.guard_article_media_columns() from public, anon, authenticated",
    );
    expect(statements).toContain("revoke all on function public.admin_list_article_authors() from public, anon");
    expect(statements).toContain(
      "grant execute on function public.admin_list_article_authors() to authenticated, service_role",
    );
    expect(code(SQL)).not.toMatch(/grant all on all tables/i);
  });

  it("requires alt text with a cover, and a time with a release", () => {
    expect(SQL).toMatch(/cover_url is null or \(cover_alt is not null and char_length\(btrim\(cover_alt\)\) > 0\)/);
    expect(SQL).toContain("check (not is_published or publish_at is not null)");
  });

  it("guards the cover like every picture column", () => {
    expect(fn(SQL, "guard_article_media_columns")).toContain(
      "public.media_url_change_allowed('article-image', v_old_cover, new.cover_url)",
    );
    expect(SQL).toMatch(/before insert or update of cover_url\s+on public\.articles/);
  });

  it("media_url_allowed is 0150's plus the article kind and its one branch", () => {
    const now = fn(SQL, "media_url_allowed");
    const before = fn(SQL_0150, "media_url_allowed");
    const branch = /  -- PipGlyph's own article diagrams[\s\S]*?end if;\n/.exec(now)![0];
    const kind = "    when 'article-image' then array['set-covers']\n";
    const stripComments = (s: string) => s.replace(/^\s*--.*\n/gm, "");
    expect(stripComments(now.replace(branch, "").replace(kind, ""))).toBe(stripComments(before));
    expect(MEDIA_KIND_BUCKETS["article-image"]).toEqual(["set-covers"]);
  });

  it("the diagram pattern is the display guard's", () => {
    const sqlPattern = /p_kind = 'article-image'\s+and p_url ~ '([^']+)'/.exec(fn(SQL, "media_url_allowed"))![1];
    expect(sqlPattern).toBe(ARTICLE_DIAGRAM.source.replace(/\\\//g, "/"));
    const sql = new RegExp(sqlPattern);
    for (const url of [
      "/article-media/naming-custom-cards/title-bar.svg",
      "/article-media/a/b.webp",
      "/article-media/a/b.jpg",
      "/article-media/../x.svg",
      "https://evil.example/article-media/a/b.svg",
      "/article-media/a/b/c.svg",
    ]) {
      expect(isAllowedMediaUrl("article-image", url), url).toBe(sql.test(url));
    }
  });
});
