"use client";

// Admin control for featured creators: add by username, unfeature with one
// click. The server action purges the gallery/challenges ISR caches.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Star, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setFeaturedAction } from "@/lib/featured/actions";

export function FeaturedManager({
  featured,
}: {
  featured: { username: string; displayName: string | null }[];
}) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [pending, startTransition] = useTransition();

  const run = (handle: string, makeFeatured: boolean) =>
    startTransition(async () => {
      const result = await setFeaturedAction(handle, makeFeatured);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(makeFeatured ? "Creator featured." : "Creator unfeatured.");
      setUsername("");
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-5">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (username.trim()) run(username, true);
        }}
      >
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="username"
          aria-label="Username to feature"
          className="w-56 rounded-md border border-border bg-elevated/40 px-3 py-2 text-sm text-foreground placeholder:text-subtle focus:border-primary/60 focus:outline-none"
        />
        <Button type="submit" disabled={pending || !username.trim()}>
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Star className="h-4 w-4" aria-hidden />
          )}
          Feature
        </Button>
      </form>

      {featured.length === 0 ? (
        <p className="text-sm text-muted">No featured creators right now.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border/40 rounded-lg border border-border/50 bg-elevated/30">
          {featured.map((f) => (
            <li key={f.username} className="flex items-center gap-3 px-4 py-3">
              <Star className="h-4 w-4 text-gold" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                {f.displayName ?? f.username}{" "}
                <span className="text-subtle">@{f.username}</span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => run(f.username, false)}
              >
                <X className="h-4 w-4" aria-hidden />
                Unfeature
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
