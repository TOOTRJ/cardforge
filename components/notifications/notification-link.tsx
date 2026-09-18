"use client";

import Link from "next/link";

// A notification row on /notifications. The page marks everything seen on
// load, so opening a row is plain navigation; `unread` only drives the
// "new" highlight for this visit.
export function NotificationLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
