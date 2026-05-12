"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

// Root error boundary. Catches uncaught errors anywhere in the tree below
// the root layout. Must be a Client Component so it can render reactively
// after the server hands us an Error. Keep it minimal — no Supabase, no
// MCP, no fetches — so it can't fail itself.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to your error tracker here when you wire one up. For now we
    // log to the browser console so devs see context during development.
    console.error("Unhandled application error:", error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-xl flex-col items-center justify-center gap-6 px-4 py-16 text-center sm:px-6">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-elevated text-danger">
        <AlertTriangle className="h-6 w-6" aria-hidden />
      </span>
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">
          Something forged sideways.
        </h1>
        <p className="text-sm leading-6 text-muted">
          An unexpected error reached the surface. Try again — if it persists,
          head back to the homepage and reach out via the about page.
        </p>
        {error.digest ? (
          <p className="font-mono text-xs text-subtle">Digest: {error.digest}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button type="button" onClick={reset}>
          <RotateCcw className="h-4 w-4" aria-hidden />
          Try again
        </Button>
        <Button asChild variant="outline">
          <Link href="/">Back to home</Link>
        </Button>
      </div>
    </div>
  );
}
