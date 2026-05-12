import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SetCreatorForm } from "@/components/sets/set-creator-form";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getCurrentUser } from "@/lib/supabase/server";
import { SurfaceCard } from "@/components/ui/surface-card";

export const metadata: Metadata = {
  title: "New set",
  description:
    "Create a new custom set — a collection of your cards grouped by theme, world, or deck.",
};

export default async function NewSetPage() {
  if (!isSupabaseConfigured()) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6 lg:px-8">
        <SurfaceCard className="flex flex-col gap-3 p-8 text-center">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            Supabase isn&apos;t configured
          </h1>
          <p className="text-sm leading-6 text-muted">
            Set the Supabase env vars to enable set creation.
          </p>
        </SurfaceCard>
      </div>
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?redirectTo=/sets/new");
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="New set"
        title="Create a custom set"
        description="Set the metadata first — you can add cards once it's saved."
        actions={
          <>
            <Badge variant="primary" className="gap-1.5">
              <Sparkles className="h-3 w-3" aria-hidden /> Phase 7
            </Badge>
            <Button asChild variant="ghost">
              <Link href="/sets">
                <ArrowLeft className="h-4 w-4" aria-hidden /> All sets
              </Link>
            </Button>
          </>
        }
      />

      <div className="mt-10">
        <SetCreatorForm mode="create" userId={user.id} />
      </div>
    </div>
  );
}
