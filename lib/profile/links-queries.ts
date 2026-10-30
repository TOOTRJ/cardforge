import "server-only";

import { cache } from "react";
import { createPublicClient } from "@/lib/supabase/public";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { drawableProfileLinks, type LinkKindKey, type ProfileLink } from "@/lib/profile/link-kinds";
import {
  drawableProfileStores,
  type ProfileStore,
  type StorePlatformKey,
} from "@/lib/profile/store-platforms";

// ---------------------------------------------------------------------------
// A profile's links and store cards (migration 0153). Viewer-independent:
// the tables are public-read, so the cookie-free client reads them (the
// profile page's other reads decide whether it is dynamic). Every row is
// re-checked before it is handed out (`drawable*`): the database only holds
// the shape, and a row written straight through the API skips the Settings
// actions' host allow-lists and strong-language check. A database migration
// 0153 hasn't reached reads as no rows (42P01), never an error page.
// ---------------------------------------------------------------------------

export const listProfileLinks = cache(async (ownerId: string): Promise<ProfileLink[]> => {
  if (!isSupabaseConfigured()) return [];
  try {
    const { data, error } = await createPublicClient()
      .from("profile_links")
      .select("id, kind, url, label, position")
      .eq("owner_id", ownerId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (error || !data) return [];
    return drawableProfileLinks(data).map((row) => ({ ...row, kind: row.kind as LinkKindKey }));
  } catch {
    return [];
  }
});

export const listProfileStores = cache(async (ownerId: string): Promise<ProfileStore[]> => {
  if (!isSupabaseConfigured()) return [];
  try {
    const { data, error } = await createPublicClient()
      .from("profile_stores")
      .select("id, platform, url, title, position")
      .eq("owner_id", ownerId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (error || !data) return [];
    return drawableProfileStores(data).map((row) => ({
      ...row,
      platform: row.platform as StorePlatformKey,
    }));
  } catch {
    return [];
  }
});
