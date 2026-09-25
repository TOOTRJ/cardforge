"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { startMarkedRebake, useMarkedRebake } from "@/components/admin/rebake-marked-store";

// ---------------------------------------------------------------------------
// "N published cards are owed a re-bake" — shown on the frame-compare pages
// whenever a frame-geometry change has marked baked cards (null stamp), and
// while the compare editor's automatic re-bake runs. Owners never see a
// badge for these (TODO 0.20); this panel is how the admin sees and clears
// them. The loop lives in rebake-marked-store.ts.
// ---------------------------------------------------------------------------

export function MarkedRendersPanel({ initialCount }: { initialCount: number }) {
  const router = useRouter();
  const run = useMarkedRebake();
  const refreshedFor = useRef<string | null>(null);

  // Pull fresh counts (and the re-baked thumbnails) once a run settles.
  useEffect(() => {
    if (run.status !== "done") return;
    const key = `${run.rebaked}:${run.failed.length}`;
    if (refreshedFor.current === key) return;
    refreshedFor.current = key;
    router.refresh();
  }, [run.status, run.rebaked, run.failed.length, router]);

  if (run.status === "idle" && initialCount === 0) return null;

  const left = run.remaining ?? initialCount;
  const warn = run.status === "error" || (run.status === "done" && run.failed.length > 0);

  return (
    <div
      className={cn(
        "mt-3 flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-xs leading-5",
        warn ? "border-gold/50 bg-gold/5 text-foreground" : "border-border/50 text-muted",
      )}
      data-testid="marked-renders-panel"
      role="status"
    >
      <p className="min-w-0 flex-1">
        {run.status === "running" ? (
          <>
            <strong className="mr-1 text-foreground">Re-baking published cards…</strong>
            {run.rebaked} done{run.remaining != null ? `, ${run.remaining} left` : ""}. Keep this tab open until it finishes.
          </>
        ) : run.status === "done" ? (
          <>
            <strong className="mr-1 text-foreground">
              Re-baked {run.rebaked} card{run.rebaked === 1 ? "" : "s"}.
            </strong>
            {run.failed.length > 0
              ? `${run.failed.length} could not be re-baked (${run.failed
                  .slice(0, 3)
                  .map((f) => f.error)
                  .join("; ")}) — they keep their old image and are retried next time.`
              : left > 0
                ? `${left} still owed a re-bake.`
                : "Every published card matches the current layout."}
          </>
        ) : run.status === "error" ? (
          <>
            <strong className="mr-1">Re-bake stopped:</strong>
            {run.error}
          </>
        ) : (
          <>
            <strong className="mr-1 text-foreground">
              {initialCount} published card{initialCount === 1 ? " is" : "s are"} owed a re-bake.
            </strong>
            A frame layout changed after they were baked. Owners don&apos;t get a
            &ldquo;newer look&rdquo; badge for this; until the re-bake, their downloads render
            live with the new layout while the gallery shows the old image.
          </>
        )}
      </p>
      {run.status === "running" ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted" aria-hidden />
      ) : left > 0 || run.status === "error" ? (
        <Button size="sm" variant="outline" onClick={() => void startMarkedRebake()}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          {run.status === "idle" ? "Re-bake now" : "Try again"}
        </Button>
      ) : null}
    </div>
  );
}
