"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import {
  getNotificationById,
  getUnreadNotificationCount,
  listNotifications,
  type NotificationItem,
} from "./queries";

// Client-callable data source for the header notification popover. Reuses the
// RLS-scoped listNotifications() so the bell can fetch on open without a
// dedicated API route.
export async function fetchNotifications(
  limit = 20,
): Promise<NotificationItem[]> {
  return listNotifications(limit);
}

/** One notification for the real-time toast (RLS-scoped; null if not ours). */
export async function fetchNotificationById(
  id: string,
): Promise<NotificationItem | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return getNotificationById(id);
}

/** Polling fallback for the real-time subscriber. */
export async function fetchUnreadNotificationCount(): Promise<number> {
  return getUnreadNotificationCount();
}

// Mark every unread notification for the current user as read. RLS restricts the
// update to the caller's own rows.
export async function markAllNotificationsRead(): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  const supabase = await createClient();
  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_id", user.id)
    .is("read_at", null);
  revalidatePath("/notifications");
  return { ok: true };
}

/** Delete every notification for the current user ("Clear all"). RLS
 *  (migration 0087) restricts the delete to the caller's own rows. */
export async function clearAllNotifications(): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase
    .from("notifications")
    .delete()
    .eq("recipient_id", user.id);
  revalidatePath("/notifications");
  return { ok: !error };
}
