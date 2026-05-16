import "server-only";

import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import type { CardCommentWithAuthor } from "@/types/card";

// ---------------------------------------------------------------------------
// Comments queries
//
// Comments are gated by `card_comments` RLS:
//   - Anyone may read comments on PUBLIC cards.
//   - The author may read their own comments regardless of card visibility.
// We surface those rules in TypeScript by always doing a parallel profiles
// lookup so the UI has a username/avatar for each comment.
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 50;

export async function listCommentsForCard(
  cardId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<CardCommentWithAuthor[]> {
  if (!isSupabaseConfigured()) return [];
  const { limit = DEFAULT_LIMIT, offset = 0 } = options;

  try {
    const supabase = await createClient();
    const { data: rows } = await supabase
      .from("card_comments")
      .select("*")
      .eq("card_id", cardId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (!rows || rows.length === 0) return [];

    const authorIds = Array.from(new Set(rows.map((r) => r.author_id)));
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url")
      .in("id", authorIds);

    const profileById = new Map<
      string,
      CardCommentWithAuthor["author"]
    >();
    for (const p of profiles ?? []) {
      profileById.set(p.id, {
        username: p.username,
        display_name: p.display_name,
        avatar_url: p.avatar_url,
      });
    }

    return rows.map((row) => ({
      ...row,
      author: profileById.get(row.author_id) ?? null,
    }));
  } catch {
    return [];
  }
}
