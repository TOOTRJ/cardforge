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
// The stream being down is never fatal and never final. While it is down —
// the socket can't be established (Realtime off, blocked websocket), the
// channel can't be set up or joined, or the server closed it — this polls
// the unread count every 45 s (no toast detail, but the badge and chrome
// still move within a minute) and looks again after a pause that doubles
// from 30 s to 5 min: it re-reads the session (which refreshes an expired
// one), hands the socket that token, and opens a channel if it holds none.
// The server closes a channel whose token has expired — every tab left in
// the background past the token's lifetime — and the client never rejoins a
// closed channel by itself: without this, alerts stopped for the rest of
// that tab's life.
//
// Nothing here may throw out of the effect — that reaches the root error
// boundary and replaces the page.
// ---------------------------------------------------------------------------

const POLL_MS = 45_000;
const REFRESH_DEBOUNCE_MS = 600;
const RETRY_MIN_MS = 30_000;
const RETRY_MAX_MS = 5 * 60_000;
/** How long the stream has to stay up before the pause goes back to its
 *  minimum. One that drops sooner is flapping, and the pause keeps growing —
 *  long enough for the polls in between to do their job. */
const STEADY_MS = 5 * 60_000;

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
  let pollRun = 0;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let lastUnread: number | null = null;
  /** When the stream came up; null while it is down. */
  let liveSince: number | null = null;
  /** Looks in a row that found it down — sets the pause before the next. */
  let misses = 0;
  let warned = false;
  let supabase: ReturnType<typeof createClient> | null = null;
  /** The channel this stream holds, if any. */
  let channel: RealtimeChannel | null = null;
  /** `subscribe()` was called on it: from then on the client retries the
   *  join by itself. Until then the channel is untouched and reusable. */
  let subscribed = false;
  /** An attempt's async steps give way to a newer attempt's. */
  let turn = 0;

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
    const run = ++pollRun;
    poll = setInterval(async () => {
      // Back, and still back a tick later: stand down. (Not the moment it
      // comes back — a stream that drops again within the minute would never
      // let a poll happen.)
      if (liveSince !== null) {
        stopPolling();
        return;
      }
      const unread = await fetchUnreadNotificationCount();
      // Stopped, or the stream came back, while that was in flight: the
      // count belongs to no outage.
      if (disposed || run !== pollRun || liveSince !== null) return;
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
    pollRun += 1;
    lastUnread = null;
  };

  /** Lets go of the channel and drops it from the client — before this
   *  returns, so the topic is free for the next subscriber in line. */
  const leave = () => {
    const leaving = channel;
    channel = null;
    subscribed = false;
    if (!leaving || !supabase) return;
    try {
      void supabase.removeChannel(leaving).catch(() => {});
    } catch {
      // A channel that will not leave must not fail the unmount.
    }
  };

  /** Arms the next look, unless one is already due. */
  const lookLater = () => {
    if (disposed || retryTimer) return;
    const pause = Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** misses);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      misses += 1;
      startPolling();
      attempt();
    }, pause);
  };

  /** The stream is up: no more looks; the next poll tick stops the polling. */
  const live = () => {
    liveSince = Date.now();
    // What it toasts from here on is not for a poll to announce again.
    lastUnread = null;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  };

  /** The stream is down: poll, and look again after the pause. */
  const down = (error?: unknown) => {
    if (disposed) return;
    if (error !== undefined && !warned) {
      warned = true;
      console.warn("[notifications] realtime subscription failed — polling, and retrying", error);
    }
    if (liveSince !== null) {
      if (Date.now() - liveSince >= STEADY_MS) misses = 0;
      liveSince = null;
    }
    startPolling();
    lookLater();
  };

  /** One go at getting the stream up — the first, and every look after. */
  const attempt = () => {
    const mine = ++turn;
    // Whatever becomes of this attempt, look again: one whose session read
    // never settles would otherwise be the last.
    lookLater();

    let client: ReturnType<typeof createClient>;
    let target: RealtimeChannel;
    try {
      supabase ??= createClient();
      client = supabase;
      target =
        channel ??
        client.channel(`notifications:${userId}`).on(
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
      // No channel of ours to hold: `.on()` throws when the topic's channel
      // is already subscribed, and that one belongs to whoever subscribed it.
      down(error);
      return;
    }
    channel = target;

    void (async () => {
      try {
        // Realtime authorises the channel with the session's JWT so RLS
        // applies to the stream; the SSR browser client reads the session
        // from cookies, and refreshes an expired one.
        const { data } = await client.auth.getSession();
        // Superseded — or the client's own retry got the stream back while
        // that was in flight, and then there is nothing left for this look
        // to do: whatever it found must not mark a live stream as down.
        if (disposed || mine !== turn || liveSince !== null) return;
        const token = data.session?.access_token;
        if (!token) {
          // Joining without it would "succeed" and deliver nothing.
          down();
          return;
        }
        await client.realtime.setAuth(token);
        // Torn down, or closed by the server, while that was in flight: the
        // channel is already removed, and subscribing it now would start a
        // join nothing could stop.
        if (disposed || mine !== turn || liveSince !== null || channel !== target) return;

        if (subscribed) {
          // The client is retrying this join by itself, from now on with
          // that token. All it will not do is reopen a socket it closed on
          // purpose, as it does once no channel has been open for a while.
          // (A fresh channel instead would queue a join the dead socket
          // replays, one per look, when it comes back.)
          if (!client.realtime.isConnected()) client.realtime.connect();
          return;
        }

        subscribed = true;
        try {
          target.subscribe((status) => {
            if (disposed || channel !== target) return;
            if (status === "SUBSCRIBED") {
              live();
            } else if (status === "CLOSED") {
              // Not our doing (leave() lets go of `channel` first): the
              // server closed it, and the client has already dropped it.
              channel = null;
              subscribed = false;
              down();
            } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
              down();
            }
          });
        } catch (error) {
          // Thrown before the join began (no socket to be had): the channel
          // is untouched, and the next attempt uses it. Past that point it
          // cannot be subscribed again — let it go.
          if (target.joinedOnce) leave();
          else subscribed = false;
          throw error;
        }
      } catch (error) {
        if (mine === turn && liveSince === null) down(error);
      }
    })();
  };

  attempt();

  return () => {
    disposed = true;
    stopPolling();
    if (refreshTimer) clearTimeout(refreshTimer);
    if (retryTimer) clearTimeout(retryTimer);
    leave();
  };
}
