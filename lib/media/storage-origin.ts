import "server-only";

import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// This deployment's storage origin, registered with its own database.
//
// Migration 0127's media URL guards accept a picture only on an origin in
// public.storage_origins. The database can't know which host its storage is
// served from, and the migration lists production's two origins only — it
// runs on every database, so any other host listed there would be trusted by
// production too (review 2026-09-29: the dev branch's host was; a seeded
// `https://*.supabase.co` made every preview trust ANY Supabase project's
// storage, an attacker's own included).
//
// So each deployment tells its database where its storage lives: before its
// first write into a user folder (lib/media/user-storage.ts upload / copyIn),
// the server upserts the origin of NEXT_PUBLIC_SUPABASE_URL — the host every
// URL it mints is on — with the service role. On production that row is
// already there (a no-op insert); a preview branch, the persistent dev
// branch and the local stack each get exactly their own origin, the moment
// they can first mint a URL on it. A storage domain move registers itself
// the same way.
//
// Once per origin per server process. A failure (the table isn't there yet —
// a deployment live before its migration — or a database hiccup) is logged
// and retried on the next write; it never fails the upload: where the row is
// missing, the save that follows is the one that fails, with the guard's own
// "isn't one of your uploads" field error.
// ---------------------------------------------------------------------------

let registered: string | null = null;
let inFlight: { origin: string; promise: Promise<void> } | null = null;

/** The origin of NEXT_PUBLIC_SUPABASE_URL (`https://auth.pipglyph.com`,
 *  `http://127.0.0.1:54321`), or null when it is missing or not http(s). */
export function ownStorageOrigin(): string | null {
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!configured) return null;
  try {
    const url = new URL(configured);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

async function register(origin: string): Promise<void> {
  try {
    const { error } = await createAdminClient()
      .from("storage_origins")
      .upsert(
        { origin, note: "registered by the app (lib/media/storage-origin.ts)" },
        { onConflict: "origin", ignoreDuplicates: true },
      );
    if (error) throw new Error(error.message);
    registered = origin;
  } catch (err) {
    console.warn(
      `[storage-origin] couldn't register ${origin} in public.storage_origins (retried on the next upload):`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Make sure this deployment's storage origin is in public.storage_origins.
 * Awaited by every user-folder write; never throws.
 */
export async function ensureStorageOriginRegistered(): Promise<void> {
  if (!isAdminConfigured()) return;
  const origin = ownStorageOrigin();
  if (!origin || registered === origin) return;
  if (!inFlight || inFlight.origin !== origin) {
    const promise = register(origin).finally(() => {
      if (inFlight?.promise === promise) inFlight = null;
    });
    inFlight = { origin, promise };
  }
  await inFlight.promise;
}

/** Tests only: forget what this process registered. */
export function resetStorageOriginRegistrationForTests(): void {
  registered = null;
  inFlight = null;
}
