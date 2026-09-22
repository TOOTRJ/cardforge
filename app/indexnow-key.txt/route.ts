import { indexNowKey } from "@/lib/seo/indexnow";

// The IndexNow key file (lib/seo/indexnow.ts). Engines fetch it once to
// verify that submissions for this host are ours. 404 wherever IndexNow is
// off (no key, previews), so a preview host never claims the production key.
export const dynamic = "force-dynamic";

export function GET() {
  const key = indexNowKey();
  if (!key) return new Response("Not found", { status: 404 });
  return new Response(key, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
