"use client";

// ---------------------------------------------------------------------------
// Notification bus — the same window-event pattern as the credits bus
// (components/billing/credits-bus.ts). The real-time subscriber lives in the
// header; the bell badge (and any future surface) reacts without the two
// sharing React state.
// ---------------------------------------------------------------------------

const NOTIFICATION_EVENT = "pipglyph:notification";

export type NotificationArrival = {
  id: string;
  type: string;
};

export function publishNotificationArrival(arrival: NotificationArrival): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<NotificationArrival>(NOTIFICATION_EVENT, { detail: arrival }),
  );
}

const SEEN_EVENT = "pipglyph:notifications-seen";

/** Fired by a surface that just marked everything seen (the /notifications
 *  page on load) so the header badge drops to zero without a refresh. */
export function publishNotificationsSeen(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SEEN_EVENT));
}

export function subscribeNotificationsSeen(onSeen: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(SEEN_EVENT, onSeen);
  return () => window.removeEventListener(SEEN_EVENT, onSeen);
}

export function subscribeNotificationArrivals(
  onArrival: (arrival: NotificationArrival) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<NotificationArrival>).detail;
    if (detail && typeof detail.id === "string") onArrival(detail);
  };
  window.addEventListener(NOTIFICATION_EVENT, handler);
  return () => window.removeEventListener(NOTIFICATION_EVENT, handler);
}
