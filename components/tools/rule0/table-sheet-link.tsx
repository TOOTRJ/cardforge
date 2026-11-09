import Link from "next/link";
import { ScrollText } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { tableSheetPath } from "@/lib/tools/rule0/model";

/** The deck page's ONE door to its Rule 0 table sheet (the owner's, while
 *  the beta tool is open to them). */
export function TableSheetLink({ deckSlug, className }: { deckSlug: string; className?: string }) {
  return (
    <Link href={tableSheetPath(deckSlug)} className={cn(buttonVariants({ variant: "outline", size: "sm" }), className)}>
      <ScrollText aria-hidden />
      Table sheet
    </Link>
  );
}
