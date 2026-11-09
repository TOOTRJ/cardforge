import Link from "next/link";
import { Palette } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { getViewerTool } from "@/lib/tools/queries";
import { toolHref } from "@/lib/tools/catalog";
import { REART_TOOL_SLUG } from "@/lib/tools/re-art/model";

/**
 * The deck page's ONE door to Re-art deck: in the owner's bar, for an owner
 * the tool is open to (nothing at all for anyone else). It opens the deck's
 * studio on the tool page.
 */
export async function DeckReartLink({ deckId }: { deckId: string }) {
  const tool = await getViewerTool(REART_TOOL_SLUG);
  if (!tool?.allowed) return null;
  return (
    <Link href={`${toolHref(REART_TOOL_SLUG)}?deck=${deckId}`} className={buttonVariants({ variant: "outline" })}>
      <Palette className="h-4 w-4" aria-hidden />
      Re-art deck
    </Link>
  );
}
