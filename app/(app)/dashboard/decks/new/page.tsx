import type { Metadata } from "next";
import DecksPage from "../page";
import { OpenNewDeckOnMount } from "@/components/decks/new-deck-provider";
import { isDeckFormat } from "@/types/deck";

// ---------------------------------------------------------------------------
// /dashboard/decks/new — My Decks with the New deck dialog open (TODO DK4.2;
// the four-step wizard that lived here is gone). The header's Account menu
// links here, and so does the dialog's signed-out round trip (TODO DK4.3):
// the auth pages send the visitor back, the dialog brings back what they
// typed. Signed out, the middleware sends this route to /login with its
// redirectTo. Dismissing the dialog goes to /dashboard/decks.
// ---------------------------------------------------------------------------

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
  const { format } = await searchParams;
  return (
    <>
      <DecksPage />
      <OpenNewDeckOnMount format={isDeckFormat(format) ? format : undefined} />
    </>
  );
}
