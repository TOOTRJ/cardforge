"use server";

import { revalidatePath } from "next/cache";
import {
  getNotificationById,
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsSeen,
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

/** Opening the bell (or a notification arriving while it is open) marks
 *  every unread notification seen — the badge and the dashboard count clear;
 *  the notifications themselves stay. */
export async function markAllNotificationsRead(): Promise<{ ok: boolean }> {
  const ok = await markAllNotificationsSeen();
  if (ok) revalidatePath("/notifications");
  return { ok };
}

