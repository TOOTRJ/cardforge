"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { markAllNotificationsRead } from "@/lib/notifications/actions";

// Marks notifications read when the page is viewed, then refreshes so the header
// bell badge clears. Guarded so it runs once and only when there's something
// unread (otherwise the post-refresh render would loop).
export function MarkReadOnView({ hasUnread }: { hasUnread: boolean }) {
  const router = useRouter();
  const done = useRef(false);

  useEffect(() => {
    if (!hasUnread || done.current) return;
    done.current = true;
    void markAllNotificationsRead().then(() => router.refresh());
  }, [hasUnread, router]);

  return null;
}
