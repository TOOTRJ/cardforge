"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import {
  fetchNotificationById,
  fetchUnreadNotificationCount,
} from "@/lib/notifications/actions";
import { describeNotification } from "@/lib/notifications/describe";
import { publishNotificationArrival } from "@/lib/notifications/bus";
import { claimNotificationStream } from "@/lib/notifications/stream-claim";
import { publishCredits } from "@/components/billing/credits-bus";

// ---------------------------------------------------------------------------
// RealtimeAlerts — the push half of notifications. Mounted in the header for
// a signed-in user; renders nothing.
//
// Subscribes (Supabase Realtime, postgres_changes) to INSERTs on the user's
// own `notifications` rows — RLS scopes the stream to recipient_id =
// auth.uid(), the filter below just keeps the socket quiet — and for each
// arrival:
//   1. toasts the same sentence the bell will show, with a "View" action;
//   2. bumps the bell badge through the notification bus;
//   3. pushes a granted credit balance onto the credits bus so the header
//      chip updates without a reload;
//   4. router.refresh()es (debounced) so the server-rendered chrome — the
//      "Messages" rail entry, unread badges, the admin inbox counts, a
//      force-dynamic page the user is looking at — catches up.
//
// ONE stream per user per tab: every mounted copy queues for it
// (lib/notifications/stream-claim.ts) and only the holder subscribes, so a
// second header on the page neither throws on the shared channel nor toasts
// a notification twice.
//
// The stream failing is never fatal. If the socket can't be established
// (Realtime off, blocked websocket) or the channel can't be set up or joined,
// this falls back to polling the unread count every 45 s: no toast detail,
// but the badge and chrome still move within a minute.
// Nothing here may throw out of the effect — that reaches the root error
// boundary and replaces the page.
// ---------------------------------------------------------------------------

const POLL_MS = 45_000;
const REFRESH_DEBOUNCE_MS = 600;

export function RealtimeAlerts({
  userId,
  isAdmin,
}: {
  userId: string;
  isAdmin: boolean;
}) {
  const router = useRouter();

  useEffect(
    () =>
      claimNotificationStream(userId, () => openStream(userId, isAdmin, router)),
    [userId, isAdmin, router],
  );

  return null;
}

/** Opens the user's stream and returns its teardown. Never throws. */
function openStream(
  userId: string,
  isAdmin: boolean,
  router: ReturnType<typeof useRouter>,
): () => void {
  let disposed = false;
  let poll: ReturnType<typeof setInterval> | null = null;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let lastUnread: number | null = null;

  const scheduleRefresh = () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => router.refresh(), REFRESH_DEBOUNCE_MS);
  };

  const onArrival = async (id: string, type: string) => {
    publishNotificationArrival({ id, type });
    const item = await fetchNotificationById(id);
    if (disposed) return;
    if (item) {
      const d = describeNotification(item, { isAdmin });
      if (item.type === "credit_grant") {
        const balance = item.payload.balance;
        if (typeof balance === "number") publishCredits(balance);
      }
      toast(`${d.subject} ${d.body}`, {
        action:
          d.href && d.href !== "#"
            ? { label: "View", onClick: () => router.push(d.href) }
            : undefined,
      });
    }
    scheduleRefresh();
  };

  const startPolling = () => {
    if (poll) return;
    poll = setInterval(async () => {
      const unread = await fetchUnreadNotificationCount();
      if (disposed) return;
      if (lastUnread != null && unread > lastUnread) {
        publishNotificationArrival({ id: `poll:${Date.now()}`, type: "unknown" });
        toast("You have new notifications.", {
          action: { label: "View", onClick: () => router.push("/notifications") },
        });
        scheduleRefresh();
      }
      lastUnread = unread;
    }, POLL_MS);
  };

  const stopPolling = () => {
    if (poll) clearInterval(poll);
    poll = null;
  };

  const stopTimers = () => {
    disposed = true;
    stopPolling();
    if (refreshTimer) clearTimeout(refreshTimer);
  };

  // The stream could not be set up or joined: say so once, and poll.
  const fallBackToPolling = (error: unknown) => {
    if (disposed) return;
    console.warn("[notifications] realtime subscription failed — polling instead", error);
    startPolling();
  };

  let supabase: ReturnType<typeof createClient>;
  let channel: RealtimeChannel;
  try {
    supabase = createClient();
    channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `recipient_id=eq.${userId}`,
        },
        (change) => {
          const row = change.new as { id?: string; type?: string };
          if (typeof row.id === "string") void onArrival(row.id, row.type ?? "unknown");
        },
      );
  } catch (error) {
    // No channel of ours to leave: `.on()` throws when the topic's channel is
    // already subscribed, and that one belongs to whoever subscribed it.
    fallBackToPolling(error);
    return stopTimers;
  }

  void (async () => {
    try {
      // Realtime authorises the channel with the session's JWT so RLS applies
      // to the stream; the SSR browser client reads the session from cookies.
      const { data } = await supabase.auth.getSession();
      if (disposed) return;
      if (data.session?.access_token) {
        await supabase.realtime.setAuth(data.session.access_token);
        // Torn down while that was in flight: the channel is already removed,
        // and subscribing it now would start a join nothing could stop.
        if (disposed) return;
      }
      channel.subscribe((status) => {
        if (disposed) return;
        if (status === "SUBSCRIBED") {
          stopPolling();
          return;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          startPolling();
        }
      });
    } catch (error) {
      fallBackToPolling(error);
    }
  })();

  return () => {
    stopTimers();
    // Leaving drops the channel from the client before this returns, so the
    // next subscriber in line gets a fresh one for the same topic.
    try {
      void supabase.removeChannel(channel).catch(() => {});
    } catch {
      // A channel that will not leave must not fail the unmount.
    }
  };
}
