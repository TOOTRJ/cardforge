import "server-only";

import { cache } from "react";
import { createPublicClient } from "@/lib/supabase/public";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { narrowCard } from "@/lib/cards/narrow";
import type { Card } from "@/types/card";
import {
  CREATORS_PAGE_SIZE,
  mapCreatorRows,
  type CreatorSort,
  type CreatorSummary,
  type PublicCreatorRow,
} from "@/lib/creators/directory";

// ---------------------------------------------------------------------------
// The /creators read (TODO NV11, migration 0148). Viewer-independent, so the
// cookie-free public client: the landing stays ISR and the browse route
// renders the same numbers for everyone. Two round trips per page — the
// directory function (who, their counts, the ids of their three newest
// public cards) and ONE read of those cards for the strips.
//
// Fail-soft: on a database without 0148 (the shared dev DB until this
// merges) the function doesn't exist — the page says the directory isn't
// available, never throws.
// ---------------------------------------------------------------------------

export type PublicCreator = CreatorSummary & {
  /** Up to three of their newest public cards, newest first. */
  strip: Card[];
};

export type CreatorsPage = {
  creators: PublicCreator[];
  total: number;
  error: string | null;
};

export const listPublicCreators = cache(
  async (sort: CreatorSort, page: number): Promise<CreatorsPage> => {
    if (!isSupabaseConfigured()) return { creators: [], total: 0, error: "offline" };
    try {
      const supabase = createPublicClient();
      const { data, error } = await supabase.rpc("list_public_creators", {
        p_sort: sort,
        p_limit: CREATORS_PAGE_SIZE,
        p_offset: (page - 1) * CREATORS_PAGE_SIZE,
      });
      if (error) {
        console.warn("listPublicCreators: rpc error", error.message);
        return { creators: [], total: 0, error: "unavailable" };
      }
      const { creators, total } = mapCreatorRows((data ?? []) as PublicCreatorRow[]);

      const ids = creators.flatMap((creator) => creator.recentCardIds);
      const byId = new Map<string, Card>();
      if (ids.length > 0) {
        // Public only, again: the ids are the function's, but a card made
        // private since must not reach a strip.
        const { data: cards, error: cardsError } = await supabase
          .from("cards")
          .select("*")
          .in("id", ids)
          .eq("visibility", "public");
        if (cardsError) console.warn("listPublicCreators: strip read failed", cardsError.message);
        for (const row of cards ?? []) byId.set(row.id, narrowCard(row));
      }

      return {
        creators: creators.map((creator) => ({
          ...creator,
          strip: creator.recentCardIds
            .map((id) => byId.get(id))
            .filter((card): card is Card => card !== undefined && card.owner_id === creator.id),
        })),
        total,
        error: null,
      };
    } catch (error) {
      console.warn("listPublicCreators: failed", error instanceof Error ? error.message : error);
      return { creators: [], total: 0, error: "unavailable" };
    }
  },
);
