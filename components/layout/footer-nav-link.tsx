"use client";

import Link from "next/link";
import { trackNavClick } from "./nav-click";

/** A footer link that reports its nav_click (TODO NV10). The footer is a
 *  static server component; this island is the only client part of it, and
 *  it reads nothing until the click (signed in = the session cookie's hint). */
export function FooterNavLink({
  id,
  href,
  className,
  children,
}: {
  id: string;
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={className} onClick={() => trackNavClick(id, "footer")}>
      {children}
    </Link>
  );
}
