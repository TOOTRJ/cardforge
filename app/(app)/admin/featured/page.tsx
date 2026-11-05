import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { FeaturedManager } from "@/components/admin/featured-manager";
import { FeaturedCardsManager } from "@/components/admin/featured-cards-manager";
import {
  HeroPoolManager,
  type AdminHeroPoolCard,
  type AdminHeroSuggestion,
  type HeroDayPair,
} from "@/components/admin/hero-pool-manager";
import { dailyHeroPair } from "@/lib/featured/hero-rotation";
import { featuredImageOf } from "@/lib/featured/queries";
import {
  FeaturedDeckThemesManager,
  type AdminDeckTheme,
} from "@/components/admin/featured-deck-themes-manager";
import { AdminLoadError } from "@/components/admin/admin-load-error";
import { getCurrentProfile } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

export const metadata: Metadata = {
  title: "Featured creators",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminFeaturedPage() {
  const profile = await getCurrentProfile();
  // Non-admins get a 404 (don't reveal the route exists).
  if (!profile?.is_admin) notFound();

  let featured: { username: string; displayName: string | null }[] = [];
  const cardSlots: [
    { slot: number; title: string; ownerUsername: string; slug: string } | null,
    { slot: number; title: string; ownerUsername: string; slug: string } | null,
  ] = [null, null];
  // A failed read must not read as "nobody featured" / "empty slot": the
  // managers below would then offer to fill what is already filled.
  let creatorsFailed = !isAdminConfigured();
  let cardsFailed = !isAdminConfigured();
  let hero: HeroPoolRead = { pool: [], suggestions: [], days: [], slotRefusals: [null, null] };
  let heroFailed = !isAdminConfigured();
  let deckThemes: AdminDeckTheme[] = [];
  let deckThemesFailed = !isAdminConfigured();
  if (isAdminConfigured()) {
    const admin = createAdminClient();
    const heroRead = await readHeroPool(admin);
    hero = heroRead ?? hero;
    heroFailed = heroRead === null;

    const themesRead = await readDeckThemes(admin);
    deckThemes = themesRead ?? [];
    deckThemesFailed = themesRead === null;
    const { data, error } = await admin
      .from("profiles")
      .select("username, display_name")
      .not("featured_at", "is", null)
      .not("username", "is", null)
      .order("featured_at", { ascending: false });
    if (error) {
      console.error("[admin/featured] featured creators read failed:", error.message);
      creatorsFailed = true;
    }
    featured = (data ?? []).map((p) => ({
      username: p.username as string,
      displayName: p.display_name,
    }));

    const { data: slots, error: slotsError } = await admin
      .from("featured_cards")
      .select("slot, cards(title, slug, owner_id)")
      .order("slot");
    if (slotsError) {
      console.error("[admin/featured] featured cards read failed:", slotsError.message);
      cardsFailed = true;
    }
    for (const row of slots ?? []) {
      const card = row.cards as unknown as {
        title: string;
        slug: string;
        owner_id: string;
      } | null;
      if (!card || (row.slot !== 1 && row.slot !== 2)) continue;
      const { data: owner, error: ownerError } = await admin
        .from("profiles")
        .select("username")
        .eq("id", card.owner_id)
        .maybeSingle();
      if (ownerError) {
        console.error("[admin/featured] featured card owner read failed:", ownerError.message);
        cardsFailed = true;
      }
      cardSlots[row.slot - 1] = {
        slot: row.slot,
        title: card.title,
        ownerUsername: owner?.username ?? "?",
        slug: card.slug,
      };
    }
  }

  return (
    <DashboardShell>
      <PageHeader
        eyebrow="Admin · Featured"
        title="Featured creators"
        description="Spotlight a creator on the gallery and challenges pages. Most recently featured leads; the banners update immediately."
      />
      {creatorsFailed ? <AdminLoadError what="the featured creators" className="mt-6" /> : null}
      <SurfaceCard className="mt-6 p-6">
        <FeaturedManager featured={featured} />
      </SurfaceCard>

      <h2 className="mt-10 text-xs font-semibold uppercase tracking-wider text-subtle">
        Homepage hero pool
      </h2>
      <p className="mt-1 text-sm text-muted">
        The home page hero shows two cards from this pool each day (UTC), the
        same two for every visitor, a new pair at midnight. Original cards only:
        a card made from a real card, a remix, a card that isn&apos;t public or
        baked, or an admin&apos;s card is held back. Changes show on the home
        page at once.
      </p>
      {heroFailed ? <AdminLoadError what="the hero pool" className="mt-4" /> : null}
      <SurfaceCard className="mt-4 p-6">
        <HeroPoolManager pool={hero.pool} suggestions={hero.suggestions} days={hero.days} />
      </SurfaceCard>

      <h2 className="mt-10 text-xs font-semibold uppercase tracking-wider text-subtle">
        Fallback hero cards
      </h2>
      <p className="mt-1 text-sm text-muted">
        Used only while the pool has fewer than two cards on the hero — the same
        checks apply. With neither, the home page shows its placeholder pair.
      </p>
      {cardsFailed ? <AdminLoadError what="the featured cards" className="mt-4" /> : null}
      <SurfaceCard className="mt-4 p-6">
        <FeaturedCardsManager slots={cardSlots} refusals={hero.slotRefusals} />
      </SurfaceCard>

      <h2 className="mt-10 text-xs font-semibold uppercase tracking-wider text-subtle">
        Featured themed decks
      </h2>
      <p className="mt-1 text-sm text-muted">
        The &ldquo;Featured themed decks&rdquo; block at the top of /decks and on the home page —
        make a theme, then paste deck page URLs into it.
      </p>
      {deckThemesFailed ? <AdminLoadError what="the featured deck themes" className="mt-4" /> : null}
      <SurfaceCard className="mt-4 p-6">
        <FeaturedDeckThemesManager themes={deckThemes} />
      </SurfaceCard>
    </DashboardShell>
  );
}

/** The themes in their order, each with its picks and why a visitor can't
 *  see a pick now (list_featured_deck_themes' rule: public, non-empty, a
 *  real creator's — owner_is_creator asked once per owner). Null = a failed
 *  read (never shown as "no themes"). */
async function readDeckThemes(admin: ReturnType<typeof createAdminClient>): Promise<AdminDeckTheme[] | null> {
  const { data: themes, error } = await admin
    .from("deck_themes")
    .select("id, title, blurb, is_live, position, created_at")
    .order("position")
    .order("created_at")
    .order("id");
  if (error) {
    console.error("[admin/featured] deck themes read failed:", error.message);
    return null;
  }
  if (!themes || themes.length === 0) return [];
  const { data: picks, error: picksError } = await admin
    .from("deck_theme_decks")
    .select("theme_id, deck_id, position, created_at, decks(title, slug, visibility, card_count, owner_id)")
    .in("theme_id", themes.map((theme) => theme.id))
    .order("position")
    .order("created_at")
    .order("deck_id");
  if (picksError) {
    console.error("[admin/featured] deck theme picks read failed:", picksError.message);
    return null;
  }
  type PickDeck = { title: string; slug: string; visibility: string; card_count: number; owner_id: string };
  const rows = (picks ?? []).map((pick) => ({ ...pick, deck: pick.decks as unknown as PickDeck | null }));
  const owners = Array.from(new Set(rows.flatMap((row) => (row.deck ? [row.deck.owner_id] : []))));
  const creators = new Map<string, boolean>();
  await Promise.all(
    owners.map(async (owner) => {
      const { data } = await admin.rpc("owner_is_creator", { p_owner_id: owner });
      creators.set(owner, data === true);
    }),
  );
  return themes.map((theme) => ({
    id: theme.id,
    title: theme.title,
    blurb: theme.blurb,
    isLive: theme.is_live,
    picks: rows
      .filter((row) => row.theme_id === theme.id && row.deck)
      .map((row) => {
        const deck = row.deck as PickDeck;
        const hiddenReason =
          deck.visibility !== "public"
            ? deck.visibility
            : deck.card_count <= 0
              ? "no cards"
              : creators.get(deck.owner_id)
                ? null
                : "maker not a creator";
        return { deckId: row.deck_id, title: deck.title, slug: deck.slug, hiddenReason };
      }),
  }));
}

type HeroPoolRead = {
  pool: AdminHeroPoolCard[];
  suggestions: AdminHeroSuggestion[];
  days: HeroDayPair[];
  /** The fallback slots' guard answers (index 0 = slot 1); null = shown. */
  slotRefusals: [string | null, string | null];
};

/** The pool, its suggestions and the next two days' pairs — every answer the
 *  database's (featured_pool_admin_list / _suggestions / home_hero_pool), the
 *  pairs picked by the home page's own dailyHeroPair. null = a read failed. */
async function readHeroPool(admin: ReturnType<typeof createAdminClient>): Promise<HeroPoolRead | null> {
  const [listRes, suggestRes, shownRes] = await Promise.all([
    admin.rpc("featured_pool_admin_list"),
    admin.rpc("featured_pool_suggestions", { p_limit: 12 }),
    admin.rpc("home_hero_pool"),
  ]);
  for (const res of [listRes, suggestRes, shownRes]) {
    if (res.error) {
      console.error("[admin/featured] hero pool read failed:", res.error.message);
      return null;
    }
  }
  const rows = listRes.data ?? [];
  const slotRefusals: [string | null, string | null] = [null, null];
  for (const r of rows) {
    if (r.source === "fallback" && (r.slot === 1 || r.slot === 2)) slotRefusals[r.slot - 1] = r.refusal;
  }
  const shown = (shownRes.data ?? [])
    .filter((r) => featuredImageOf(r))
    .map((r) => ({ ...r, id: r.card_id }));
  const now = Date.now();
  const days: HeroDayPair[] = [
    { label: "On the hero today", at: new Date(now) },
    { label: "Tomorrow (from 00:00 UTC)", at: new Date(now + 86_400_000) },
  ].map((d) => ({ label: d.label, titles: dailyHeroPair(shown, d.at).map((r) => r.title) }));
  return {
    pool: rows
      .filter((r) => r.source === "pool")
      .map((r) => ({
        cardId: r.card_id,
        title: r.title,
        slug: r.slug,
        ownerUsername: r.username,
        refusal: r.refusal,
      })),
    suggestions: (suggestRes.data ?? []).map((r) => ({
      cardId: r.card_id,
      title: r.title,
      slug: r.slug,
      ownerUsername: r.username,
      likes: r.likes_count,
      thumbUrl: featuredImageOf(r),
    })),
    days,
    slotRefusals,
  };
}
