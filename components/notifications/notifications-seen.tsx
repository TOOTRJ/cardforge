"use client";

import { useEffect } from "react";
import { publishNotificationsSeen } from "@/lib/notifications/bus";

// Mounted by /notifications after the server marked everything seen during
// render: tells the header bell (rendered in parallel by the layout, so it
// may still carry the old count) to drop its badge to zero.
export function NotificationsSeen() {
  useEffect(() => {
    publishNotificationsSeen();
  }, []);
  return null;
}
