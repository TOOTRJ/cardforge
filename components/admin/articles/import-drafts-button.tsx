"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileDown } from "lucide-react";
import { toast } from "sonner";
import { adminErrorToast } from "@/lib/admin/admin-toast";
import { Button } from "@/components/ui/button";
import { importArticleDraftsAction } from "@/lib/content/article-actions";

/** "Import drafts" — loads content/article-drafts/ as DRAFTS (skipping any
 *  slug that exists). The owner's way to bring the shipped drafts to
 *  production; nothing is scheduled or published. */
export function ImportDraftsButton({ available }: { available: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (available === 0) return null;
  return (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await importArticleDraftsAction();
          if (!result.ok) {
            adminErrorToast("articles", result.error);
            return;
          }
          toast.success(
            result.imported.length === 0
              ? "Every shipped draft is already here."
              : `Imported ${result.imported.length} draft${result.imported.length === 1 ? "" : "s"}${
                  result.skipped.length ? ` (${result.skipped.length} already here)` : ""
                }.`,
          );
          router.refresh();
        })
      }
    >
      <FileDown className="h-4 w-4" aria-hidden />
      {pending ? "Importing…" : `Import drafts (${available})`}
    </Button>
  );
}
