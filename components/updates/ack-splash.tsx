"use client";

// ---------------------------------------------------------------------------
// AckSplash — the blocking "must read" dialog for signed-in users. Mounted in
// the root layout as an auth island: no session cookie → zero network; with
// one, it asks /api/updates/pending-ack and, when anything is outstanding,
// opens a dialog that cannot be dismissed by clicking outside or pressing
// Escape — only the "Got it" button, which records the acknowledgement for
// every update shown (site_update_acks) so it never comes back.
// ---------------------------------------------------------------------------

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Megaphone, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { hasSupabaseSessionCookie } from "@/lib/supabase/session-cookie";
import { acknowledgeUpdatesAction } from "@/lib/updates/actions";
import { KIND_COPY, formatReleaseDate, type SiteUpdateKind } from "@/lib/updates/shared";

type PendingUpdate = {
  id: string;
  kind: SiteUpdateKind;
  title: string;
  summary: string;
  body: string | null;
  link_href: string | null;
  publish_at: string;
};

export function AckSplash() {
  const [pending, setPending] = useState<PendingUpdate[]>([]);
  const [saving, startTransition] = useTransition();

  useEffect(() => {
    if (!hasSupabaseSessionCookie()) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/updates/pending-ack", { cache: "no-store" });
        if (!res.ok) return;
        const data: { updates: PendingUpdate[] } = await res.json();
        if (!cancelled && data.updates.length > 0) setPending(data.updates);
      } catch {
        // Offline or blocked — the splash simply waits for the next load.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (pending.length === 0) return null;

  const acknowledge = () =>
    startTransition(async () => {
      const result = await acknowledgeUpdatesAction(pending.map((p) => p.id));
      if (result.ok) setPending([]);
    });

  return (
    <Dialog open onOpenChange={() => undefined}>
      <DialogContent
        hideCloseButton
        size="lg"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-gold" aria-hidden />
            {pending.length === 1 ? "A quick word from the forge" : "A few quick words from the forge"}
          </DialogTitle>
          <DialogDescription>
            Something changed on PipGlyph that we want every forger to know about.
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
          {pending.map((u) => (
            <article
              key={u.id}
              className="flex flex-col gap-2 rounded-lg border border-border/60 bg-elevated/40 p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={u.kind === "update" ? "gold" : "default"}>
                  {u.kind === "upcoming" ? (
                    <Sparkles className="mr-1 h-3 w-3" aria-hidden />
                  ) : null}
                  {KIND_COPY[u.kind].label}
                </Badge>
                <span className="text-xs text-subtle">{formatReleaseDate(u.publish_at)}</span>
              </div>
              <h3 className="font-display text-lg font-semibold text-foreground">{u.title}</h3>
              <p className="text-sm leading-6 text-muted">{u.summary}</p>
              {u.body ? (
                <p className="whitespace-pre-line text-sm leading-6 text-foreground/90">{u.body}</p>
              ) : null}
              {u.link_href ? (
                <Link
                  href={u.link_href}
                  className="text-sm font-medium text-primary-bright hover:underline"
                >
                  Learn more →
                </Link>
              ) : null}
            </article>
          ))}
        </div>
        <DialogFooter>
          <Button type="button" onClick={acknowledge} disabled={saving}>
            {saving ? "Saving…" : "Got it — thanks!"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
