import type { Metadata } from "next";
import { ToolShell } from "@/components/tools/tool-shell";
import { SetSymbolStudio } from "@/components/tools/set-symbol-studio/studio-workspace";
import { isGatewayConfigured } from "@/lib/ai/provider";
import { openTool } from "@/lib/tools/queries";
import { listMySymbols } from "@/lib/tools/set-symbol/queries";

// ---------------------------------------------------------------------------
// /dashboard/tools/set-symbol-studio — the Set Symbol Studio beta tool: a set
// icon and its watermark, drawn by FLUX from a description (1 credit) or cut
// from the maker's own picture (free, no model), painted in every rarity and
// handed to the creator. Admins and testers while in beta (openTool: a 404
// for anyone else).
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  title: "Set Symbol Studio",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";
// The upload / re-cut server actions decode, key and paint on this route.
export const maxDuration = 60;

export default async function SetSymbolStudioPage() {
  const entry = await openTool("set-symbol-studio");
  const symbols = await listMySymbols(entry.userId);
  return (
    <ToolShell entry={entry}>
      <SetSymbolStudio initialSymbols={symbols} aiReady={isGatewayConfigured()} />
    </ToolShell>
  );
}
