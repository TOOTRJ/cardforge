"use client";

// Owner-only bar on the deck page when the deck's latest AI job left cards
// unfinished: one click re-runs exactly the failed steps through the global
// runner (progress widget + details dialog), then refreshes the page.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, RotateCcw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";
import { useGenerationJob } from "@/components/ai/use-generation-job";

export function DeckRegenerateBar({
  jobId,
  failedCount,
  failedLabels,
}: {
  jobId: string;
  failedCount: number;
  failedLabels: string[];
}) {
  const router = useRouter();
  const { retryJob, busy } = useGenerationJob();
  const [working, setWorking] = useState(false);

  const regenerate = async () => {
    setWorking(true);
    try {
      const outcome = await retryJob(jobId);
      if (outcome.failures === 0 && outcome.successes > 0) {
        toast.success("Every card is in — the deck is complete.");
      } else if (outcome.successes > 0) {
        toast.message(`${outcome.failures} still failed — try again in a moment.`);
      }
      router.refresh();
    } finally {
      setWorking(false);
    }
  };

  const preview = failedLabels.slice(0, 3).join(", ");

  return (
    <SurfaceCard className="mt-8 flex flex-wrap items-center gap-4 border-danger/40 bg-danger/5 p-5">
      <TriangleAlert className="h-5 w-5 shrink-0 text-danger" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-semibold text-foreground">
          {failedCount} {failedCount === 1 ? "card didn't" : "cards didn't"} generate
        </span>
        <span className="truncate text-xs text-muted">
          {preview}
          {failedLabels.length > 3 ? ` +${failedLabels.length - 3} more` : ""} — usually a hiccup painting the art.
        </span>
      </div>
      <Button type="button" onClick={() => void regenerate()} disabled={working || busy}>
        {working || busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />}
        Regenerate {failedCount === 1 ? "it" : "them"}
      </Button>
    </SurfaceCard>
  );
}
