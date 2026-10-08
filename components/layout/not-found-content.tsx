import Link from "next/link";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";

// The 404 page's body — no site chrome. app/not-found.tsx puts the shell
// around it (an unmatched URL has only the root layout); every route group's
// own not-found.tsx renders it bare, inside that group's layout.

export function NotFoundContent() {
  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-xl flex-col items-center justify-center gap-6 px-4 py-16 text-center sm:px-6">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-elevated text-primary-bright">
        <Compass className="h-6 w-6" aria-hidden />
      </span>
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">
          404 — That card isn&apos;t in the forge.
        </h1>
        <p className="text-sm leading-6 text-muted">
          The page you tried to reach doesn&apos;t exist, or you don&apos;t
          have permission to see it. Try one of the paths below.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button asChild>
          <Link href="/">Home</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/gallery">Browse gallery</Link>
        </Button>
        <Button asChild variant="ghost">
          <Link href="/create">Forge a card</Link>
        </Button>
      </div>
    </div>
  );
}
