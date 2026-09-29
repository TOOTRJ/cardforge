import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Migration 0126: users hold NO write policy on storage.objects — every
// upload, overwrite and delete in a user bucket is a server action writing
// with the service role (lib/media/user-storage.ts). This replays every
// `create policy` / `drop policy` on storage.objects across all migrations,
// in order, and pins the policy set a fresh branch ends with:
//
//   * no INSERT / UPDATE / DELETE / ALL policy on any bucket;
//   * exactly the two owner SELECT policies (0038 card-renders, 0039
//     custom-pips) — reads are unchanged;
//   * frames (0116) still has none at all.
//
// The replay was checked against the local stack's pg_policies before 0126
// (the same 20 policies, 18 of them writes). It can't see production drift;
// 0126's DO block covers that, and its shape is pinned below.
//
// 0126 also makes a card's render pointer the server's
// (cards_guard_render_columns): an API role may only keep or CLEAR
// rendered_image_url / rendered_thumb_url / rendered_at / layout_version.
// The trigger's behaviour per role was run against a scratch Postgres; the
// e2e spec tests/e2e/storage-direct-writes.spec.ts proves both halves on the
// CI stack with a real signed-in session. This file pins the SQL's shape.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const FILE = "0126_storage_server_writes.sql";

const USER_BUCKETS = ["card-art", "card-exports", "set-covers", "card-renders", "profile-media", "custom-pips"];

type Policy = { cmd: string; bucket: string | null; from: string };

const stripComments = (sql: string) =>
  sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

/** The storage.objects policies left after applying `files` in order. */
function replay(files: string[]): Map<string, Policy> {
  const policies = new Map<string, Policy>();
  for (const file of files) {
    const sql = stripComments(readFileSync(join(dir, file), "utf8"));
    const statement = /\b(create|drop)\s+policy\s+(?:if\s+exists\s+)?"([^"]+)"\s+on\s+storage\.objects\b([\s\S]*?);/gi;
    for (const [, verb, name, rest] of sql.matchAll(statement)) {
      if (verb.toLowerCase() === "drop") {
        policies.delete(name);
        continue;
      }
      const cmd = /\bfor\s+(select|insert|update|delete|all)\b/i.exec(rest)?.[1].toUpperCase() ?? "ALL";
      const bucket = /bucket_id\s*=\s*'([^']+)'/.exec(rest)?.[1] ?? null;
      policies.set(name, { cmd, bucket, from: file });
    }
  }
  return policies;
}

const migrations = readdirSync(dir)
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort();

describe("storage.objects policies after every migration", () => {
  const before = replay(migrations.filter((f) => f < FILE));
  const after = replay(migrations);

  it("the replay sees the pre-0126 world: 18 owner-folder write policies + 2 owner reads", () => {
    const writes = [...before.values()].filter((p) => p.cmd !== "SELECT");
    expect(writes).toHaveLength(18);
    expect(new Set(writes.map((p) => p.bucket))).toEqual(new Set(USER_BUCKETS));
    expect([...before.values()].filter((p) => p.cmd === "SELECT")).toHaveLength(2);
  });

  it("no API role can insert, update or delete an object in any bucket", () => {
    const writes = [...after.entries()].filter(([, p]) => p.cmd !== "SELECT");
    expect(writes).toEqual([]);
  });

  it("reads are unchanged: exactly the two owner SELECT policies remain", () => {
    expect(Object.fromEntries(after)).toEqual({
      "Owners can read their own card renders": { cmd: "SELECT", bucket: "card-renders", from: "0038_card_renders_select_policy.sql" },
      "Owners can read their own custom pips": { cmd: "SELECT", bucket: "custom-pips", from: "0039_custom_pips.sql" },
    });
  });

  it("frames still has no policy at all (service role only, 0116)", () => {
    expect([...after.values()].filter((p) => p.bucket === "frames")).toEqual([]);
  });
});

describe(`${FILE}`, () => {
  const raw = readFileSync(join(dir, FILE), "utf8");
  const sql = stripComments(raw);
  const flat = (text: string) => text.replace(/\s+/g, " ").trim();
  const doBlock = /do \$\$([\s\S]*?)\$\$;/i.exec(sql)?.[1] ?? "";
  const guardFn = /create or replace function public\.guard_card_render_columns\(\)([\s\S]*?)\$\$;/i.exec(sql)?.[0] ?? "";
  const rest = sql.replace(/do \$\$[\s\S]*?\$\$;/i, "").replace(guardFn, "");
  const statements = rest
    .split(";")
    .map((s) => flat(s))
    .filter(Boolean);
  const RENDER_COLUMNS = ["rendered_image_url", "rendered_thumb_url", "rendered_at", "layout_version"];

  it("drops the 18 owner-folder write policies by name, idempotently", () => {
    const drops = statements.filter((s) => s.startsWith("drop policy"));
    expect(drops).toHaveLength(18);
    for (const s of drops) expect(s).toMatch(/^drop policy if exists "[^"]+" on storage\.objects$/);
  });

  it("the drift guard drops EVERY remaining write policy on storage.objects, whatever bucket it names", () => {
    const guard = flat(doBlock);
    expect(guard).toMatch(/from pg_policies/);
    expect(guard).toMatch(/schemaname = 'storage'/);
    expect(guard).toMatch(/tablename = 'objects'/);
    expect(guard).toMatch(/cmd in \('INSERT', 'UPDATE', 'DELETE', 'ALL'\)/);
    expect(guard).not.toMatch(/'SELECT'/);
    // No bucket filter: a hand-made production policy that says `true`,
    // `bucket_id <> 'x'`, or names no bucket at all must not survive.
    expect(guard).not.toMatch(/card-art|card-renders|profile-media|bucket_id|~|like/i);
    expect(guard).toMatch(/execute format\('drop policy %I on storage\.objects', p\.policyname\)/);
    expect(guard).toMatch(/raise warning/);
  });

  it("creates no policy and grants nothing; the only privilege statement revokes the trigger function", () => {
    const bare = flat(sql).replace(/"[^"]*"/g, '""');
    expect(bare).not.toMatch(/\bcreate policy\b/i);
    expect(bare).not.toMatch(/\bgrant\b/i);
    expect(bare).not.toMatch(/\balter table\b/i);
    expect(bare).not.toMatch(/\bdelete\s+from\b/i);
    const privileges = statements.filter((s) => /^(grant|revoke)\b/i.test(s));
    expect(privileges).toEqual([
      "revoke all on function public.guard_card_render_columns() from public, anon, authenticated",
    ]);
  });

  it("guards the four render columns on INSERT and UPDATE OF them, for public.cards", () => {
    const trigger = statements.find((s) => s.startsWith("create trigger"));
    expect(trigger).toBe(
      `create trigger cards_guard_render_columns before insert or update of ${RENDER_COLUMNS.join(", ")} on public.cards for each row execute function public.guard_card_render_columns()`,
    );
    expect(statements).toContain("drop trigger if exists cards_guard_render_columns on public.cards");
  });

  it("the guard: only anon / authenticated are checked, they may only keep or clear, and a refusal is 42501", () => {
    const fn = flat(guardFn);
    expect(fn).toMatch(/returns trigger language plpgsql set search_path = ''/);
    // SECURITY INVOKER (the default) on purpose: current_user is the caller.
    expect(fn).not.toMatch(/security definer/i);
    expect(fn).toMatch(/if current_user not in \('anon', 'authenticated'\) then return new; end if;/);
    // INSERT: none of the four may be set.
    const insertBranch = /if tg_op = 'INSERT' then(.*?)elsif/.exec(fn)?.[1] ?? "";
    for (const col of RENDER_COLUMNS) expect(insertBranch).toContain(`new.${col} is not null`);
    // UPDATE: a column may change only to NULL.
    const updateBranch = /elsif(.*?)then raise/.exec(fn)?.[1] ?? "";
    for (const col of RENDER_COLUMNS) {
      expect(updateBranch).toContain(`(new.${col} is not null and new.${col} is distinct from old.${col})`);
    }
    expect(fn.match(/using errcode = 'insufficient_privilege'/g)).toHaveLength(2);
  });

  it("the guarded columns are exactly the render columns 0108 keeps out of updated_at", () => {
    const m0108 = readFileSync(join(dir, "0108_hub_counts_and_render_updated_at.sql"), "utf8");
    const line = m0108.split("\n").find((l) => l.includes("- 'rendered_image_url'")) ?? "";
    expect([...line.matchAll(/- '([a-z_]+)'/g)].map((m) => m[1])).toEqual(RENDER_COLUMNS);
  });

  it("clears pre-0126 pointers that aren't the card's own card-renders object", () => {
    const updates = statements.filter((s) => s.startsWith("update public.cards"));
    expect(updates).toHaveLength(2);
    expect(updates[0]).toContain(
      "set rendered_image_url = null, rendered_thumb_url = null, rendered_at = null, layout_version = null",
    );
    expect(updates[0]).toContain(
      "split_part(c.rendered_image_url, '?', 1) not like '%/storage/v1/object/public/card-renders/' || c.owner_id::text || '/' || c.id::text || '.png'",
    );
    expect(updates[1]).toContain("set rendered_thumb_url = null");
    expect(updates[1]).toContain(
      "split_part(c.rendered_thumb_url, '?', 1) not like '%/storage/v1/object/public/card-renders/' || c.owner_id::text || '/' || c.id::text || '.thumb.webp'",
    );
    // The clean-up runs before the guard exists (the migration's role would
    // pass it anyway).
    expect(sql.indexOf("update public.cards")).toBeLessThan(sql.indexOf("create trigger"));
  });

  it("states its grants in the header", () => {
    expect(raw).toMatch(/^-- Grants: none new\./m);
  });
});
