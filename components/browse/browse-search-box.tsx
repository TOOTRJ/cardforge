"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// BrowseSearchBox — the search entry point on the static landings (/gallery,
// /decks). Those pages never read searchParams, so a search is a NAVIGATION
// to the dynamic browse sibling (`/gallery/browse?q=…`), never a query on
// the landing itself. The form's native GET action is that path, so it works
// before hydration; once React is up the submit becomes a soft navigation.
// ---------------------------------------------------------------------------

export function BrowseSearchBox({
  browsePath,
  placeholder,
  label,
  browseLabel,
}: {
  /** The dynamic sibling every search lands on, e.g. "/gallery/browse". */
  browsePath: string;
  placeholder: string;
  /** Accessible name of the search field. */
  label: string;
  /** Label of the "see everything" button beside the field. */
  browseLabel: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [isPending, startTransition] = useTransition();

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const q = value.trim();
    const href = q ? `${browsePath}?q=${encodeURIComponent(q)}` : browsePath;
    startTransition(() => {
      router.push(href);
    });
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <form
        action={browsePath}
        method="get"
        role="search"
        onSubmit={onSubmit}
        className="relative flex-1"
      >
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle"
          aria-hidden
        />
        <input
          name="q"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          type="search"
          placeholder={placeholder}
          aria-label={label}
          className="h-11 w-full rounded-lg border border-border bg-surface pl-10 pr-10 text-sm text-foreground shadow-sm placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        />
        {isPending ? (
          <Loader2
            className="absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted"
            aria-hidden
          />
        ) : null}
        <button type="submit" className="sr-only">
          Search
        </button>
      </form>
      <Button asChild variant="outline" className="h-11">
        <Link href={browsePath}>
          {browseLabel}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </Button>
    </div>
  );
}
