import type { Metadata } from "next";
import { ToolShell } from "@/components/tools/tool-shell";
import { PipForge } from "@/components/tools/pip-forge/forge-workspace";
import { isGatewayConfigured } from "@/lib/ai/provider";
import { getPipOverrides } from "@/lib/pips/queries";
import { openTool } from "@/lib/tools/queries";
import { listMyPips } from "@/lib/tools/pip-forge/queries";

// ---------------------------------------------------------------------------
// /dashboard/tools/pip-forge — the Pip Forge beta tool: a custom mana pip
// built for card size (FLUX draws the glyph; it is cleaned and set on our own
// disc, checked at 16 and 24 px) and the colour it stands for, from one
// description (1 credit). A pip becomes one of the maker's six custom pips
// through the custom pips' own write. Admins and testers while in beta
// (openTool: a 404 for anyone else).
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  title: "Pip Forge",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";
// The recolour / "use as a pip" server actions paint and upload on this route.
export const maxDuration = 60;

export default async function PipForgePage() {
  const entry = await openTool("pip-forge");
  const [pips, overrides] = await Promise.all([listMyPips(entry.userId), getPipOverrides(entry.userId)]);
  return (
    <ToolShell entry={entry}>
      <PipForge initialPips={pips} initialOverrides={overrides} aiReady={isGatewayConfigured()} />
    </ToolShell>
  );
}
