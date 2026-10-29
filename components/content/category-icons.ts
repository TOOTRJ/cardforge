import { BookOpen, PenTool, Scale, ScrollText, type LucideIcon } from "lucide-react";
import type { ArticleCategorySlug } from "@/lib/content/article-categories";

// ---------------------------------------------------------------------------
// One icon per /learn category — the hub's cards and the category pages'
// "Other topics" row draw the same glyph for the same shelf. Kept out of
// lib/content/article-categories.ts so that module stays React-free.
// ---------------------------------------------------------------------------

export const CATEGORY_ICONS: Record<ArticleCategorySlug, LucideIcon> = {
  design: PenTool,
  reference: BookOpen,
  comparisons: Scale,
  lore: ScrollText,
};
