"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { listNotifications, type NotificationItem } from "./queries";

// Client-callable data source for the header notification popover. Reuses the
// RLS-scoped listNotifications() so the bell can fetch on open without a
// dedicated API route.
export async function fetchNotifications(
  limit = 20,
): Promise<NotificationItem[]> {
  return listNotifications(limit);
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
