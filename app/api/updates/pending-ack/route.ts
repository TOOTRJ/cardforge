import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/server";
import { listPendingAcks } from "@/lib/updates/queries";

// Signed-in viewer's outstanding must-read updates (for the splash island in
// the root layout). Anonymous → empty; never cached.
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ updates: [] });
  const updates = await listPendingAcks();
  return NextResponse.json(
    {
      updates: updates.map((u) => ({
        id: u.id,
        kind: u.kind,
        title: u.title,
        summary: u.summary,
        body: u.body,
        link_href: u.link_href,
        publish_at: u.publish_at,
      })),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
