import type { Metadata } from "next";
import { ToolShell } from "@/components/tools/tool-shell";
import { SymbolsManager, type ForgedPipChoice } from "@/components/tools/custom-symbols/symbols-manager";
import { listSymbolsOf } from "@/lib/symbols/queries";
import { getViewerTool, openTool } from "@/lib/tools/queries";
import { listMyPips } from "@/lib/tools/pip-forge/queries";
import { PIP_FORGE_SLUG } from "@/lib/tools/pip-forge/model";

// ---------------------------------------------------------------------------
// /dashboard/tools/custom-symbols — the New mana symbols beta tool (0193):
// a maker's own mana symbols beyond the six, written {*CODE} on their cards.
// Admins and testers while in beta (openTool: a 404 for anyone else). A
// forged pip (Pip Forge) can become a symbol when that tool is open too.
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  title: "New mana symbols",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function CustomSymbolsPage() {
  const entry = await openTool("custom-symbols");
  const forge = await getViewerTool(PIP_FORGE_SLUG);
  const [symbols, pips] = await Promise.all([
    listSymbolsOf(entry.userId),
    forge?.allowed ? listMyPips(entry.userId) : Promise.resolve([]),
  ]);
  const forgedPips: ForgedPipChoice[] = pips.map((pip) => ({ id: pip.id, name: pip.name, imageUrl: pip.files.pip }));
  return (
    <ToolShell entry={entry}>
      <SymbolsManager initialSymbols={symbols} forgedPips={forgedPips} />
    </ToolShell>
  );
}
