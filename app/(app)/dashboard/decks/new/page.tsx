import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { DeckWizard } from "@/components/decks/deck-wizard";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getCurrentUser } from "@/lib/supabase/server";
import { SurfaceCard } from "@/components/ui/surface-card";
import { isDeckFormat } from "@/types/deck";

export const metadata: Metadata = {
  title: "New deck",
  description:
    "Create a new MTG deck — pick a format, then add real cards and your own custom creations.",
};

type PageProps = {
  /** `?format=` — a format hub's "Build a <format> deck" picks it. */
  searchParams: Promise<{ format?: string | string[] }>;
};

export default async function NewDeckPage({ searchParams }: PageProps) {
  if (!isSupabaseConfigured()) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6 lg:px-8">
        <SurfaceCard className="flex flex-col gap-3 p-8 text-center">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            Supabase isn&apos;t configured
          </h1>
          <p className="text-sm leading-6 text-muted">
            Set the Supabase env vars to enable deck creation.
          </p>
        </SurfaceCard>
      </div>
    );
  }

  const { format: formatParam } = await searchParams;
  const initialFormat = isDeckFormat(formatParam) ? formatParam : undefined;

  const user = await getCurrentUser();
  if (!user) {
    const back = initialFormat ? `/dashboard/decks/new?format=${initialFormat}` : "/dashboard/decks/new";
    redirect(`/login?redirectTo=${encodeURIComponent(back)}`);
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="New deck"
        title="Create a deck"
        description="Name it, choose how the cards arrive — a pasted decklist or by hand — add a cover, and forge."
        actions={
          <Button asChild variant="ghost">
            <Link href="/dashboard/decks">
              <ArrowLeft className="h-4 w-4" aria-hidden /> All decks
            </Link>
          </Button>
        }
      />

      <div className="mt-10">
        <DeckWizard userId={user.id} initialFormat={initialFormat} />
      </div>
    </div>
  );
}
