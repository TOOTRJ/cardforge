"use client";

import { Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReportDialog } from "@/components/moderation/report-dialog";
import { reportCardAction } from "@/lib/moderation/actions";

export function ReportCardDialog({ cardId }: { cardId: string }) {
  return (
    <ReportDialog
      title="Report this card"
      description="Tell us what's wrong. Reports are reviewed by our moderation team."
      onSubmit={(reason, details) =>
        reportCardAction({ cardId, reason, details })
      }
      trigger={
        <Button variant="ghost" size="sm" title="Report this card">
          <Flag className="h-4 w-4" aria-hidden /> Report
        </Button>
      }
    />
  );
}
