import { toolHref } from "@/lib/tools/catalog";
import { COLLECTION_TOOL_SLUG } from "./limits";

// The tool page's four views — ONE address each (`?view=`), so a view is a
// link the browser's back button and a bookmark both understand.

export const COLLECTION_VIEWS = ["collection", "add", "build", "decks"] as const;
export type CollectionView = (typeof COLLECTION_VIEWS)[number];

export const COLLECTION_VIEW_LABELS: Record<CollectionView, string> = {
  collection: "My collection",
  add: "Add cards",
  build: "Build a deck",
  decks: "Decks you can build",
};

export function collectionViewOf(value: unknown): CollectionView {
  return (COLLECTION_VIEWS as readonly unknown[]).includes(value) ? (value as CollectionView) : "collection";
}

export function collectionViewHref(view: CollectionView, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams(view === "collection" ? extra : { view, ...extra });
  const query = params.toString();
  return `${toolHref(COLLECTION_TOOL_SLUG)}${query ? `?${query}` : ""}`;
}
