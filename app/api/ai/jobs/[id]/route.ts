import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getGenerationJob } from "@/lib/ai/generation-jobs";

// GET /api/ai/jobs/[id] — job status/steps for progress UIs and resume.
// RLS scopes the read to the owner; anyone else sees a 404.

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Supabase isn't configured." },
      { status: 503 },
    );
  }
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Sign in." }, { status: 401 });
  }
  const { id } = await params;
  const job = await getGenerationJob(id);
  if (!job) {
    return NextResponse.json(
      { ok: false, error: "Job not found." },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, job }, { status: 200 });
}
