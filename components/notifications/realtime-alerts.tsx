"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import {
  fetchNotificationById,
  fetchUnreadNotificationCount,
} from "@/lib/notifications/actions";
import { describeNotification } from "@/lib/notifications/describe";
import { publishNotificationArrival } from "@/lib/notifications/bus";
import { publishCredits } from "@/components/billing/credits-bus";

// ---------------------------------------------------------------------------
// RealtimeAlerts — the push half of notifications. Mounted once in the header
// for a signed-in user; renders nothing.
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
// If the socket can't be established (Realtime off, blocked websocket) it
// falls back to polling the unread count every 45 s: no toast detail, but
// the badge and chrome still move within a minute.
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
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let disposed = false;
    let poll: ReturnType<typeof setInterval> | null = null;
    let lastUnread: number | null = null;
    const supabase = createClient();

    const scheduleRefresh = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => router.refresh(), REFRESH_DEBOUNCE_MS);
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

    const channel = supabase
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

    void (async () => {
      // Realtime authorises the channel with the session's JWT so RLS applies
      // to the stream; the SSR browser client reads the session from cookies.
      const { data } = await supabase.auth.getSession();
      if (disposed) return;
      if (data.session?.access_token) {
        await supabase.realtime.setAuth(data.session.access_token);
      }
      channel.subscribe((status) => {
        if (disposed) return;
        if (status === "SUBSCRIBED") {
          if (poll) {
            clearInterval(poll);
            poll = null;
          }
          return;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          startPolling();
        }
      });
    })();

    return () => {
      disposed = true;
      if (poll) clearInterval(poll);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      void supabase.removeChannel(channel);
    };
  }, [userId, isAdmin, router]);

  return null;
}
