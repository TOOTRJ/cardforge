import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// ONE finish per staged card-art upload (review 2026-09-29): finishes fired
// in parallel on one name all read the staged file before the first one's
// tombstone lands, so the finish claims the name first — migration 0131's
// claim_card_art_upload(), whose primary key answers true to exactly one
// caller. Storage can't do it (racing no-upsert uploads of one key all
// succeed). The claim is service-role only and fails CLOSED.
// ---------------------------------------------------------------------------

const rpc = vi.hoisted(() => ({
  calls: [] as { fn: string; args: unknown }[],
  answer: { data: true as unknown, error: null as null | { message: string } },
  throws: false,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (fn: string, args: unknown) => {
      rpc.calls.push({ fn, args });
      if (rpc.throws) throw new Error("network");
      return rpc.answer;
    },
  }),
}));

import { claimStagedCardArt } from "@/lib/cards/art-upload-claim";

const USER = "11111111-1111-4111-8111-111111111111";
const NAME = "22222222-2222-4222-8222-222222222222.upload";

beforeEach(() => {
  rpc.calls.length = 0;
  rpc.answer = { data: true, error: null };
  rpc.throws = false;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("claimStagedCardArt", () => {
  it("asks claim_card_art_upload for the caller's (user, name) and wins only on `true`", async () => {
    expect(await claimStagedCardArt(USER, NAME)).toBe(true);
    expect(rpc.calls).toEqual([{ fn: "claim_card_art_upload", args: { p_user_id: USER, p_staged_name: NAME } }]);
    rpc.answer = { data: false, error: null };
    expect(await claimStagedCardArt(USER, NAME)).toBe(false);
  });

  it("fails closed: an error, a throw, or any other answer is not a claim", async () => {
    rpc.answer = { data: null, error: { message: "permission denied" } };
    expect(await claimStagedCardArt(USER, NAME)).toBe(false);
    for (const data of [null, "true", 1, [true], { claimed: true }]) {
      rpc.answer = { data, error: null };
      expect(await claimStagedCardArt(USER, NAME), JSON.stringify(data)).toBe(false);
    }
    rpc.throws = true;
    expect(await claimStagedCardArt(USER, NAME)).toBe(false);
  });
});

describe("migration 0131's claim", () => {
  const sql = readFileSync(path.resolve(__dirname, "../../../supabase/migrations/0131_card_art_upload_limit.sql"), "utf8");
  const body = sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ");

  it("is decided by the primary key: insert … on conflict do nothing, `found` to the one that inserted", () => {
    expect(body).toContain("create table if not exists public.card_art_upload_claims (");
    expect(body).toContain("primary key (user_id, staged_name)");
    expect(body).toContain("user_id uuid not null references auth.users (id) on delete cascade");
    expect(body).toContain(
      "insert into public.card_art_upload_claims (user_id, staged_name) values (p_user_id, p_staged_name) on conflict (user_id, staged_name) do nothing; return found;",
    );
    expect(body).toContain("create or replace function public.claim_card_art_upload( p_user_id uuid, p_staged_name text ) returns boolean");
  });

  it("is service-role only: RLS on, no policy, revoked from every API role", () => {
    expect(body).toContain("alter table public.card_art_upload_claims enable row level security;");
    expect(body).not.toMatch(/create policy/i);
    expect(body).toContain("revoke all on table public.card_art_upload_claims from public, anon, authenticated;");
    expect(body).toContain("grant select, insert, delete on table public.card_art_upload_claims to service_role;");
    expect(body).toContain("revoke all on function public.claim_card_art_upload(uuid, text) from public, anon, authenticated;");
    expect(body).toContain("grant execute on function public.claim_card_art_upload(uuid, text) to service_role;");
    expect(body).not.toMatch(/grant [^;]* to (anon|authenticated|public)\b/i);
  });

  it("prunes claims older than a day (the signed URL they guard lives 2 hours)", () => {
    expect(body).toContain("where c.claimed_at <= now() - interval '1 day' limit 500 for update skip locked");
  });
});
