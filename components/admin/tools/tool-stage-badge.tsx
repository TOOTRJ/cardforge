import { Badge } from "@/components/ui/badge";
import type { ToolStage } from "@/lib/tools/access";

/** A tool's stage on the admin pages: Not built / Beta / released to … / Paused. */
export function ToolStageBadge({ built, stage, label }: { built: boolean; stage: ToolStage; label: string }) {
  if (stage === "paused") return <Badge variant="danger">Paused</Badge>;
  if (!built) return <Badge variant="outline">Not built · {stage === "released" ? label : "Beta"}</Badge>;
  if (stage === "beta") return <Badge variant="primary">Beta</Badge>;
  return <Badge variant="gold">Released · {label}</Badge>;
}
