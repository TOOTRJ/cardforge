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
  const sql = stripComments(readFileSync(join(dir, FILE), "utf8"));
  const doBlock = /do \$\$([\s\S]*?)\$\$;/i.exec(sql)?.[1] ?? "";
  const outsideDo = sql.replace(/do \$\$[\s\S]*?\$\$;/i, "");
  const statements = outsideDo
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  it("is idempotent drops only — no create, grant, revoke or alter", () => {
    expect(statements).toHaveLength(18);
    for (const s of statements) expect(s).toMatch(/^drop policy if exists "[^"]+" on storage\.objects$/);
    // Outside the policy names (which say "upload" / "update") and the drift
    // guard (pinned below), no other DDL or DML.
    const bare = outsideDo.replace(/"[^"]*"/g, '""');
    expect(bare).not.toMatch(/\b(create|grant|revoke|alter|insert|update|truncate)\b/i);
    expect(bare).not.toMatch(/\bdelete\s+from\b/i);
  });

  it("the drift guard drops only write policies that name a user bucket", () => {
    expect(doBlock).toMatch(/from pg_policies/);
    expect(doBlock).toMatch(/schemaname = 'storage'/);
    expect(doBlock).toMatch(/tablename = 'objects'/);
    expect(doBlock).toMatch(/cmd in \('INSERT', 'UPDATE', 'DELETE', 'ALL'\)/);
    expect(doBlock).not.toMatch(/'SELECT'/);
    const buckets = /'''\(([^)]+)\)'''/.exec(doBlock)?.[1].split("|");
    expect(buckets?.sort()).toEqual([...USER_BUCKETS].sort());
    expect(doBlock).toMatch(/execute format\('drop policy %I on storage\.objects', p\.policyname\)/);
  });

  it("states its grants in the header", () => {
    expect(readFileSync(join(dir, FILE), "utf8")).toMatch(/^-- Grants: none\./m);
  });
});
