import { NextResponse } from "next/server";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

// The caller's most recent "Get ideas" batch (migration 0092), so the
// dialog can reopen it without spending another credit — e.g. after the
// tab was closed while the batch was generating.

const LAST_IDEAS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export async function GET() {
  if (!isSupabaseConfigured()) return NextResponse.json({ ok: true, batch: null });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: true, batch: null });
  const supabase = await createClient();
  const { data } = await supabase
    .from("card_idea_batches")
    .select("id, request, ideas, created_at")
    .eq("owner_id", user.id)
    .gte("created_at", new Date(Date.now() - LAST_IDEAS_WINDOW_MS).toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return NextResponse.json({ ok: true, batch: data ?? null });
}
