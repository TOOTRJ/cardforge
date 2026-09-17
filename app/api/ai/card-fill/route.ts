import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import type { CardFillResult } from "@/lib/ai/card-fill-shared";

// ---------------------------------------------------------------------------
// Unclaimed AI fills (owner decision 2026-09-17). A card_fill job's result
// rides on its step (JobStep.fill); the creator applies it as soon as the
// step returns. If the tab is closed first, the credit is spent and the
// result sits unused — so the creator asks here on load for the newest
// finished, unclaimed fill for the same scope ("create", "card:<id>" or
// "remix:<id>") and offers to apply it. Claiming (applied OR discarded)
// stamps request.claimed_at so it is never offered twice.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";

const UNCLAIMED_WINDOW_MS = 24 * 60 * 60 * 1000;

const scopeSchema = z.string().trim().min(1).max(80);

type JobRow = {
  id: string;
  owner_id: string;
  kind: string;
  status: string;
  request: Record<string, unknown> | null;
  steps: Array<{ status?: string; fill?: CardFillResult | null }> | null;
  created_at: string;
};

export async function GET(request: Request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ ok: true, fill: null });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: true, fill: null });
  const scope = scopeSchema.safeParse(new URL(request.url).searchParams.get("scope"));
  if (!scope.success) return NextResponse.json({ ok: true, fill: null });

  const supabase = await createClient();
  const { data } = await supabase
    .from("ai_generation_jobs")
    .select("id, owner_id, kind, status, request, steps, created_at")
    .eq("kind", "card_fill")
    .eq("status", "done")
    .gte("created_at", new Date(Date.now() - UNCLAIMED_WINDOW_MS).toISOString())
    .order("created_at", { ascending: false })
    .limit(10);
  const rows = (data ?? []) as unknown as JobRow[];
  const match = rows.find(
    (row) =>
      row.request?.scope === scope.data &&
      !row.request?.claimed_at &&
      row.steps?.[0]?.status === "done" &&
      row.steps?.[0]?.fill,
  );
  if (!match) return NextResponse.json({ ok: true, fill: null });
  return NextResponse.json({
    ok: true,
    fill: { jobId: match.id, result: match.steps![0].fill, createdAt: match.created_at },
  });
}

const claimSchema = z.object({ jobId: z.string().uuid() });

export async function POST(request: Request) {
  if (!isSupabaseConfigured() || !isAdminConfigured()) {
    return NextResponse.json({ ok: false, error: "Not configured." }, { status: 503 });
  }
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in." }, { status: 401 });
  const parsed = claimSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }
  // Ownership through the caller's own session (RLS), the write with the
  // service role (job rows aren't owner-writable, migration 0073).
  const supabase = await createClient();
  const { data: owned } = await supabase
    .from("ai_generation_jobs")
    .select("id, request")
    .eq("id", parsed.data.jobId)
    .eq("kind", "card_fill")
    .maybeSingle();
  if (!owned) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
  const requestJson = ((owned.request as Record<string, unknown> | null) ?? {});
  await createAdminClient()
    .from("ai_generation_jobs")
    .update({ request: { ...requestJson, claimed_at: new Date().toISOString() } })
    .eq("id", parsed.data.jobId)
    .eq("owner_id", user.id);
  return NextResponse.json({ ok: true });
}
