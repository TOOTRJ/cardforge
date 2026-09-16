"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { markNotificationRead } from "@/lib/notifications/actions";

// A notification row on /notifications: opening it marks just that one
// read (the page no longer marks everything read on view — "Clear all" or
// opening an item is what clears the badge, like most apps).
export function NotificationLink({
  id,
  href,
  unread,
  className,
  children,
}: {
  id: string;
  href: string;
  unread: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <Link
      href={href}
      className={className}
      onClick={() => {
        if (unread) void markNotificationRead(id).then(() => router.refresh());
      }}
    >
      {children}
    </Link>
  );
}
