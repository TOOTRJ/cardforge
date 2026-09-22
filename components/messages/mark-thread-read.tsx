"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { adminMarkThreadReadAction, markThreadReadAction } from "@/lib/messages/actions";

// Marks a thread read for the viewer's side once per mount (only when there
// is something unread), then refreshes so the nav badge and the list agree.
// Same pattern as the notifications page's seen-on-open mark.
export function MarkThreadRead({
  threadId,
  side,
  hasUnread,
}: {
  threadId: string;
  side: "user" | "admin";
  hasUnread: boolean;
}) {
  const router = useRouter();
  const done = useRef<string | null>(null);

  useEffect(() => {
    if (!hasUnread || done.current === threadId) return;
    done.current = threadId;
    const action = side === "admin" ? adminMarkThreadReadAction : markThreadReadAction;
    void action(threadId).then(() => router.refresh());
  }, [threadId, side, hasUnread, router]);

  return null;
}
