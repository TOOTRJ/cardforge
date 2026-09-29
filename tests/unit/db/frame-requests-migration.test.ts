import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FRAME_REQUEST_ART_FLAGS,
  FRAME_REQUEST_CAUSES,
  FRAME_REQUEST_SOURCES,
  FRAME_REQUEST_STATUSES,
} from "@/lib/frames/frame-requests";

// ---------------------------------------------------------------------------
// Migration 0123 (TODO 1.6) as text: it states its grants (branches don't
// auto-grant; production auto-grants everything, so the revokes matter), it
// never hands the table to an API role wholesale, only admins read, the one
// write is the auth.uid()-stamped function, and its CHECK vocabularies match
// the app's (lib/frames/frame-requests.ts). It is applied for real by the
// PR's Supabase preview branch and the CI e2e stack.
// ---------------------------------------------------------------------------

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/0123_frame_requests.sql"),
  "utf8",
);
const body = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .replace(/\s+/g, " ")
  .toLowerCase();

const RECORD_SIG =
  "public.record_frame_request(text, text, text, text, uuid, text, text, text, text, text)";
const COUNTS_SIG = "public.admin_frame_request_counts(timestamptz)";

describe("0123_frame_requests.sql", () => {
  it("never grants all", () => {
    expect(body).not.toMatch(/grant all/);
  });

  it("states the table's grants: admins read through RLS, the service role writes", () => {
    expect(body).toContain("grant select on public.frame_requests to authenticated;");
    expect(body).toContain(
      "grant select, insert, update, delete on public.frame_requests to service_role;",
    );
    expect(body).toContain("revoke all on public.frame_requests from anon;");
    expect(body).toMatch(/revoke insert, update, delete[^;]* on public\.frame_requests from authenticated;/);
  });

  it("states the functions' grants: the write for signed-in users, the counts for the service role only", () => {
    expect(body).toContain(`revoke all on function ${RECORD_SIG} from public, anon;`);
    expect(body).toContain(`grant execute on function ${RECORD_SIG} to authenticated;`);
    expect(body).toContain(`revoke all on function ${COUNTS_SIG} from public, anon, authenticated;`);
    expect(body).toContain(`grant execute on function ${COUNTS_SIG} to service_role;`);
    expect(body).not.toMatch(/grant execute on function public\.admin_frame_request_counts[^;]*authenticated/);
  });

  it("turns RLS on with an admin-only select policy and no write policies", () => {
    expect(body).toContain("alter table public.frame_requests enable row level security;");
    expect(body).toMatch(
      /create policy "frame requests: admin read" on public\.frame_requests for select using \(public\.viewer_is_admin\(\)\);/,
    );
    expect(body).not.toMatch(/on public\.frame_requests for (insert|update|delete|all)/);
  });

  it("writes only as the caller, security definer with a pinned search_path, capped per hour", () => {
    const record = body.slice(body.indexOf("create or replace function public.record_frame_request"));
    expect(record).toMatch(/security definer set search_path = public/);
    expect(record).toContain("auth.uid()");
    expect(record).toMatch(/interval '1 hour' \) >= 30 then return;/);
    const counts = body.slice(body.indexOf("create or replace function public.admin_frame_request_counts"));
    expect(counts).toMatch(/stable security definer set search_path = public/);
  });

  it("indexes the reads", () => {
    expect(body).toContain("on public.frame_requests (signature, created_at desc)");
    expect(body).toContain("on public.frame_requests (created_at)");
  });

  it("checks the same vocabularies as the app", () => {
    const list = (values: readonly string[]) => `(${values.map((v) => `'${v}'`).join(", ")})`;
    expect(body).toContain(`status in ${list(FRAME_REQUEST_STATUSES)}`);
    expect(body).toContain(`cause text not null check (cause in ${list(FRAME_REQUEST_CAUSES)})`);
    expect(body).toContain(`source in ${list(FRAME_REQUEST_SOURCES)}`);
    expect(body).toContain(`art_flag in ${list(FRAME_REQUEST_ART_FLAGS)}`);
    // …in the function's own validation too.
    expect(body).toContain(`p_status not in ${list(FRAME_REQUEST_STATUSES)}`);
    expect(body).toContain(`p_cause not in ${list(FRAME_REQUEST_CAUSES)}`);
    expect(body).toContain(`p_source not in ${list(FRAME_REQUEST_SOURCES)}`);
    expect(body).toContain(`p_art_flag not in ${list(FRAME_REQUEST_ART_FLAGS)}`);
  });

  it("stores why a row is logged, and an unverified frame only as nearest (D1)", () => {
    expect(body).toMatch(
      /constraint frame_requests_unverified_is_nearest check \(cause <> 'unverified' or status = 'nearest'\)/,
    );
    expect(body).toContain("(p_cause = 'unverified' and p_status <> 'nearest')");
    expect(body).toMatch(/insert into public\.frame_requests \([^)]*\bcause\b[^)]*\) values \([^)]*\bp_cause\b/);
  });

  it("counts per signature + set + cause, most distinct users first, then requests (D1, D4)", () => {
    const counts = body.slice(body.indexOf("create or replace function public.admin_frame_request_counts"));
    expect(counts).toMatch(/returns table \( signature text, label text, set_code text, cause text,/);
    expect(counts).toContain("group by r.signature, r.set_code, r.cause");
    expect(counts).toContain(
      "order by count(distinct r.user_id) desc, count(*) desc, max(r.created_at) desc limit 500",
    );
  });

  it("caps the columns where the app's schema does", () => {
    expect(body).toContain("char_length(signature) between 1 and 120");
    expect(body).toContain("char_length(label) between 1 and 160");
    expect(body).toContain("char_length(set_code) <= 10");
    expect(body).toContain("char_length(collector_number) <= 16");
    expect(body).toContain("char_length(template) <= 40");
  });
});
