// ---------------------------------------------------------------------------
// Our storage hosts — the hosts this project has minted public storage URLs
// on. Client-safe and dependency-free (CardPreview and the gallery tiles
// import it), so it must stay free of server and validation imports.
//
// The Supabase URL moved to the custom domain in 2026-07, but every `*_url`
// stored before then still points at the project's original hostname, which
// Supabase serves forever (see next.config.ts LEGACY_SUPABASE_HOSTNAME).
// Leaving it off this list made every re-bake of an older card fetch a
// transparent pixel instead of its art — black art boxes in the gallery
// (2026-09-16).
//
// The database has its own list for the media URL guards (migration 0127
// public.storage_origins): production's two origins from the migration, and
// each deployment's own, registered by lib/media/storage-origin.ts before its
// first upload. When the storage domain moves, the OLD host goes here (the
// new one registers itself on both sides).
// ---------------------------------------------------------------------------

export const LEGACY_SUPABASE_HOSTS: readonly string[] = ["zkwkisxoqdhdchqyjwdc.supabase.co"];

/** The configured storage host (NEXT_PUBLIC_SUPABASE_URL) plus the legacy
 *  ones — `host` includes a non-default port (`127.0.0.1:54321`). */
export function ownStorageHosts(): Set<string> {
  const hosts = new Set<string>(LEGACY_SUPABASE_HOSTS);
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (configured) {
    try {
      hosts.add(new URL(configured).host);
    } catch {
      // ignore a malformed env value
    }
  }
  return hosts;
}

const PUBLIC_OBJECT_PATH = /^\/storage\/v1\/object\/public\/([a-z0-9-]+)\/(.+)$/;

/** `{ bucket, key }` of a public object URL on one of our storage hosts
 *  (http or https, any query string), null for anything else. The key is
 *  the URL's pathname after the bucket — already normalised by URL, so a
 *  `..` segment can't survive into it. */
export function ownStorageObject(
  url: string | null | undefined,
): { bucket: string; key: string } | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (parsed.username || parsed.password) return null;
  if (!ownStorageHosts().has(parsed.host)) return null;
  const match = PUBLIC_OBJECT_PATH.exec(parsed.pathname);
  if (!match) return null;
  return { bucket: match[1], key: match[2] };
}
