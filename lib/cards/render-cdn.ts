import { LEGACY_SUPABASE_HOSTS } from "@/lib/validation/card";
// ---------------------------------------------------------------------------
// render-cdn — map a stored card-render URL (Supabase Storage, `card-renders`
// bucket) onto this deployment's `/render-cdn/<owner>/<object>?v=…` path,
// which the route handler at app/render-cdn/[...path]/route.ts proxies to the
// bucket and serves with an immutable one-year Cache-Control (the storage
// host answers browsers `no-cache`).
// Only URLs on our own storage hosts are mapped; anything else is returned
// untouched so a foreign or malformed value can never be proxied.
// ---------------------------------------------------------------------------

const RENDER_CDN_PREFIX = "/render-cdn";

const BUCKET_PATH = "/storage/v1/object/public/card-renders/";

export function toRenderCdnUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (!parsed.pathname.startsWith(BUCKET_PATH)) return url;
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const ownHosts = new Set<string>(LEGACY_SUPABASE_HOSTS);
  if (configured) {
    try {
      ownHosts.add(new URL(configured).host);
    } catch {
      // ignore a malformed env value
    }
  }
  if (!ownHosts.has(parsed.host)) return url;
  const object = parsed.pathname.slice(BUCKET_PATH.length);
  if (!/^[A-Za-z0-9_\-./]+$/.test(object) || object.includes("..")) return url;
  return `${RENDER_CDN_PREFIX}/${object}${parsed.search}`;
}
