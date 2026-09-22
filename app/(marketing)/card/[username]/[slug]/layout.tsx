import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getCardByOwnerAndSlug } from "@/lib/cards/queries";
import { isSupabaseConfigured } from "@/lib/supabase/env";

// ---------------------------------------------------------------------------
// Existence check OUTSIDE the segment's loading boundary. A layout renders
// before its sibling loading.tsx's Suspense, so a missing (or unreadable)
// card answers a real HTTP 404 instead of a 200 shell that later swaps in the
// not-found UI — a "soft 404" search engines keep recrawling and never drop.
// The lookup is React cache()-deduped with generateMetadata, generateViewport
// and the page body, so this costs nothing extra.
// ---------------------------------------------------------------------------

export default async function CardDetailLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ username: string; slug: string }>;
}) {
  if (isSupabaseConfigured()) {
    const { username, slug } = await params;
    const card = await getCardByOwnerAndSlug(username, slug);
    if (!card) notFound();
  }
  return children;
}
