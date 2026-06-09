import type { Metadata } from "next";
import Link from "next/link";
import { Users } from "lucide-react";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { GalleryCardTile } from "@/components/cards/gallery-card-tile";
import { listFollowingFeed } from "@/lib/cards/queries";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Your feed",
  description: "The newest cards from creators you follow.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function FeedPage() {
  const user = await getCurrentUser();
  const cards = user ? await listFollowingFeed(user.id, { limit: 48 }) : [];

  return (
    <DashboardShell>
      <PageHeader
        eyebrow="Following"
        title="Your feed"
        description="The newest public cards from creators you follow."
      />

      <div className="mt-8">
        {cards.length === 0 ? (
          <EmptyState
            icon={Users}
            title="Your feed is empty"
            description="Follow creators to see their newest cards here. Open any card or profile and hit Follow to get started."
            action={
              <Button asChild>
                <Link href="/gallery">Browse the gallery</Link>
              </Button>
            }
          />
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {cards.map((card) => (
              <GalleryCardTile key={card.id} card={card} isAuthed />
            ))}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
