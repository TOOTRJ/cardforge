# TODO

- [ ] **Point `.env.local` at the local Supabase stack** instead of
      production (docs/ENVIRONMENTS.md §1). Deliberately deferred on
      2026-07-09 — until then, local dev reads AND WRITES the live DB, so
      no destructive local experiments. When switching: `npm run db:start`,
      copy the keys from `supabase status`, optionally keep a
      `.env.production-peek` to swap in consciously.

- [ ] **New guide: "Card Conjurer alternative"** (target keyword: *card
      conjurer alternative*; secondary: *cardconjurer alternative*, *card
      conjurer replacement*, *card conjurer not working*, *custom mtg card
      maker like card conjurer*). Persuasive, honest comparison written for
      someone whose Card Conjurer workflow broke or stalled: what Card
      Conjurer did well (frame fidelity, free, offline-ish), what PipGlyph
      does better (live preview = print output, verified frame geometry from
      real scans, custom mana pips, AI art/rules assistant, deck proxy
      printing, gallery/sharing, no install), an honest "where Card Conjurer
      still wins" section (trust signal), a migration path ("rebuild your
      card in 3 minutes" walkthrough with the Scryfall import), and an FAQ.
      SEO/AI-search checklist: file `content/articles/card-conjurer-alternative.mdx`
      with `title` "The Best Card Conjurer Alternative in 2026 (Free MTG Card
      Maker)", `description` ≤155 chars containing the keyword, tags
      `["card makers", "comparison", "card design"]` so it joins the
      existing `/best-mtg-card-makers` cluster; H1 = keyword phrase, H2s as
      natural questions ("Is there a Card Conjurer alternative that works in
      the browser?", "Can I import my Card Conjurer cards?"), a comparison
      table (feature × PipGlyph / Card Conjurer), FAQ section rendered with
      the `FAQPage` JSON-LD helper (`components/seo/json-ld.tsx`), internal
      links to `/mtg-card-maker`, `/best-mtg-card-makers`, `/preview`,
      `/articles/how-to-print-proxy-mtg-cards`, and a `<Callout>` CTA to
      `/preview` (no account needed). Add the slug to the "Best card makers"
      page's cross-links and to `lib/content/clusters.ts`; regenerate the
      per-article OG image automatically (existing `opengraph-image.tsx`).
      Keep claims verifiable (no invented Card Conjurer bugs); date it and
      set `updated` when Card Conjurer's status changes.

## Audit follow-ups (2026-09-14)

Open findings from the full-site audit (verified; the full report with evidence is
linked from the audit PRs). Items already fixed in PRs #251–#255 are not listed.
Numbers in brackets are severities; `file:line` points at the evidence.

### Critical / high — do these first

- [ ] **[critical] Owner-deletable/updatable ai_generation_jobs rows turn the reconcile cron into a self-serve credit refund** — `supabase/migrations/0059_ai_generation_jobs.sql`:74. See bugs-a-13: settle spends server-side (service-role-only `settled_at`/settlements table) and refund only aged UNSETTLED spends, never on a missing job; drop the owner UPDATE/DELETE policies on ai_generation_jobs (route the remaining writes through RPCs) and
- [ ] **[critical] Owner-writable/deletable job rows let any user get every AI credit refunded by the reconcile cron while keeping the generated cards** — `supabase/migrations/0059_ai_generation_jobs.sql`:70. Stop using owner-writable job JSON as settlement proof: on a charged success, stamp settlement through the service role (e.g. a SECURITY DEFINER `settle_spend(p_ref)` that sets `credit_ledger.settled_at`, callable only from the server executor, or a settlement
- [ ] **[high] profiles is world-readable with no column restrictions — Stripe ids, credits, comp/admin flags exposed via anon PostgREST** — `supabase/migrations/0001_profiles.sql`:63. Add a migration that revokes SELECT on public.profiles from anon/authenticated and grants column-level SELECT on only the public columns (id, username, display_name, avatar_url, bio, featured_at, ...); give owners their full row via a SECURITY DEFINER `my_prof
- [ ] **[high] Every user's Stripe ids, credits, admin flag and comp state are readable by anonymous PostgREST callers** — `supabase/migrations/0001_profiles.sql`:63. Split the table: move billing/admin columns into a `profile_private` (or `billing_accounts`) table with `select using (auth.uid() = id)` RLS and service-role writes, or keep the columns but `revoke select on public.profiles from anon, authenticated` and `grant
- [ ] **[high] Owner-writable ai_generation_jobs rows turn the reconcile-credits sweep into a free-refund oracle** — `supabase/migrations/0059_ai_generation_jobs.sql`:69. Drop the owner UPDATE/DELETE policies (or add a BEFORE UPDATE trigger that raises when `steps`, `status`, `plan`, `request`, `set_id`, `deck_id` change for non-service roles, mirroring protect_billing_columns) and route cancel through a narrow security-definer

### Medium

- [ ] **[medium] Password-reset and confirmation links only work in the browser that requested them (PKCE verifier cookie)** — `app/(auth)/actions.ts`:202. Follow Supabase's server-side email flow: customize the Confirm-signup and Reset-password email templates to link to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type={{ .Type }}&redirectTo=...`, and add an `/auth/confirm` route that calls `supabas
- [ ] **[medium] Unlisted cards are listed (and counted) on the creator's public profile page** — `app/(marketing)/profile/[username]/page.tsx`:482. Change `listPublicCardsByOwner` and the count query to `.eq("visibility", "public")` (the pinned path at :668 already does), and keep `SHAREABLE_VISIBILITIES` only for the direct-link/OG routes. If unlisted-on-profile was intended, update the publish-panel and
- [ ] **[medium] OAuth-provider avatar URLs go through next/image without `unoptimized`, but only Supabase storage hosts are allowlisted** — `components/cards/card-detail-content.tsx`:843. Add `unoptimized` to the avatar `<Image>` in card-detail-content.tsx (matching the other avatar sites), or mirror OAuth avatars into the profile-media bucket at signup so profiles.avatar_url is always a storage URL.
- [ ] **[medium] Card detail page hand-builds the front-face <CardPreview> bag and omits `watermark`/`faceContent` while importing cardToPreviewData for the back card — live preview diverges from the bake** — `components/cards/card-detail-content.tsx`:279. card-detail-content.tsx: `<CardPreview {...cardToPreviewData(card, profileOverrides)} pipOverrides={pipOverrides} backFace={...} backCard={...} footerWatermark={...} />` once cardToPreviewData carries backFace (see dup-01 fix). set-card-sortable.tsx: `<CardPre
- [ ] **[medium] Leaving an Adventure/Split/Flip/Aftermath kind never clears has_back_face — standard frames then can't save or persist a phantom back face** — `components/creator/card-creator-form.tsx`:778. In applyKindPatch, when `!KIND_DEFS[nextKind].inlineSecondFace` and the previous template `hasInlineBackFace`, `setValue("has_back_face", false)` and reset `back_face` to EMPTY_BACK_FACE; additionally make runSubmit send `back_face: null` unless `hasInlineBack
- [ ] **[medium] Server field errors on keys no panel renders (face_content, back_card_id) are swallowed; 7-row planeswalker can never be saved** — `components/creator/card-creator-form.tsx`:1401. Mirror the counts in cardFormSchema (issue on `loyalty_abilities`/`saga_chapters` when surviving rows > 6), cap seeded rows at 6 in the kind-switch seeding, and in applyFieldErrors fall back to `setServerError`/toast for any key `buildFieldToStep()` does not m
- [ ] **[medium] 'Create a new card' for the back face navigates /create → /create?backFor= without remounting the form** — `components/creator/card-creator-form.tsx`:1483. Key the form on the flow in create/page.tsx (`key={backFor?.id ?? deckRemix?.deckCardId ?? "new"}`), or add an effect in the form that `reset(defaults)` + `goToIndex(0)` when `backForCardId` changes and skips the pending draft write.
- [ ] **[medium] Deck edit cannot clear the description or remove the cover — 'Changes saved' but nothing changes** — `components/decks/deck-creator-form.tsx`:153. Give the wire format an explicit 'clear' value: make `deckDescriptionSchema`/`deckCoverUrlSchema` `.nullable()` (e.g. `optionalEmptyString(schema).or(z.null())`) and have the form send `null` (not `undefined`) when the trimmed input is empty in edit mode; `upd
- [ ] **[medium] Gallery search/filter changes keep a stale ?page while the sets/decks search copies reset it** — `components/gallery/gallery-filters.tsx`:88. Extract `useSearchParamPatch()` (sets/deletes keys, always deletes 'page', router.replace with scroll:false) into lib/routing/use-search-param-patch.ts and use it in gallery-filters, sets-search and decks-search.
- [ ] **[medium] AI card remix saves artist_credit as null, so every AI-remixed card renders 'Art: Unknown'** — `lib/ai/generation-jobs.ts`:934. Add an optional `artistCredit?: string | null` to RemixCardInput, pass `artistCredit: await aiArtistCredit()` from executeCardRemixStep, and in remixCardAction use `input.artistCredit ?? (input.artUrl ? undefined : parent.artist_credit)`.
- [ ] **[medium] Comments are accepted on unlisted cards but the SELECT policy only exposes comments on public cards** — `lib/cards/comments-actions.ts`:104. Add a migration that drops and recreates the SELECT policy with `c.visibility in ('public','unlisted')` (link-holders and the owner can read/moderate), or alternatively reject unlisted in createCommentAction and hide the composer on unlisted pages — but keep t
- [ ] **[medium] Comments on UNLISTED cards are invisible to the card owner (and every non-author viewer) yet still fire an owner notification** — `lib/cards/comments-actions.ts`:104. New migration replacing the 0019 SELECT policy with `exists (select 1 from public.cards c where c.id = card_id and (c.visibility in ('public','unlisted') or c.owner_id = auth.uid())) or author_id = auth.uid()` — i.e. comments readable wherever the card is read
- [ ] **[medium] Admin 'Hide card' does not purge the card's cached surfaces or the CDN-cached OG image, unlike the owner-side private flip** — `lib/moderation/actions.ts`:178. Export `revalidateCardPaths`/`revalidateDiscoverySurfaces` (or a `purgeCardEverywhere(cardId, slug, ownerUsername)` helper) from lib/cards/actions.ts and call it from the hide branch, including `revalidatePath(`/api/cards/${cardId}/og`)`; select `slug` and the
- [ ] **[medium] Re-reporting a card/comment after its earlier report was dismissed/actioned is silently swallowed as success (owner can re-publish a hidden card unflagged)** — `lib/moderation/actions.ts`:48. Replace the plain UNIQUE with a partial unique index `where status = 'pending'` (migration), and on 23505 (now only true duplicates) keep the idempotent success. Alternatively, on conflict do `update ... set status='pending', reason=..., created_at=now() where
- [ ] **[medium] Flagged custom-pip upload deletes the owner's previously approved pip object but leaves the custom_pips row pointing at it** — `lib/pips/actions.ts`:121. Moderate before overwriting the canonical object: scan the normalized PNG bytes (base64 data URL) or upload to a temp path, scan, then copy to the canonical path; only upsert the object + row after the scan passes, leaving an existing approved pip untouched on
- [ ] **[medium] Deck export 500s whenever a deck title or card name contains a non-WinAnsi character** — `lib/render/card-pdf.ts`:338. Embed a Unicode-capable TTF for the checklist (register `@pdf-lib/fontkit` and `doc.embedFont(<Beleren/MPlantin bytes from lib/render/card-fonts.ts>)`), or sanitize heading/lines by replacing characters Helvetica cannot encode; also cap the heading length.
- [ ] **[medium] Set editor cannot clear cover, icon, or description — 'Remove'/'Use default' save as silent no-ops** — `lib/sets/actions.ts`:210. Same fix as bugs-b-01: make the four optional string schemas accept `null` as an explicit clear, have the form send `null` for emptied fields in edit mode, and keep `update.x = data.x ?? null`. The `iconChanged` computation then works unchanged and triggers th
- [ ] **[medium] deleteSetAction leaves every member card rendering the deleted set's symbol (stale set_icon_url/set_icon_code, no re-bake)** — `lib/sets/actions.ts`:302. In `deleteSetAction`, before the delete, select `cards.id` where `primary_set_id = setId`, then for each either re-home to the oldest remaining membership (reuse `repointPrimaryAfterRemoval`) or clear `set_icon_url`/`set_icon_code`, and schedule the deferred b
- [ ] **[medium] cards.updated_at is bumped by every view and like — gallery 'Recent' sort means 'recently viewed' (the 0057 deck fix was never applied to cards)** — `supabase/migrations/0003_card_data_model.sql`:160. New migration porting the 0057 guard into set_cards_updated_at: `if (to_jsonb(new) - 'view_count' - 'likes_count' - 'updated_at') is distinct from (to_jsonb(old) - ...) then new.updated_at = now(); else new.updated_at = old.updated_at; end if;`. Note in the PR
- [ ] **[medium] admin/rebake re-inlines bake-render.ts's upload → getPublicUrl → ?v= → row-update sequence and the private-card cleanup; the copy dropped the retry + leak log** — `app/api/admin/rebake/route.ts`:136. Move `uploadRenderAndPersist(supabase, path, pngBytes, cardId)` and export `removeRenderObject` from lib/cards/bake-core.ts (its stated purpose is shared bake plumbing); bake-render.ts and rebake/route.ts both call them so the retry+log applies to rebake.
- [ ] **[medium] Nine card-tile previewData literals duplicate cardToPreviewData and all omit watermark/faceContent** — `components/cards/gallery-card-tile.tsx`:64. Replace each literal with `previewData={cardToPreviewData(card, profileOverrides)}` (cardToPreviewData already accepts Card; trending/gallery tiles pass profileOverrides where they have it).
- [ ] **[medium] db-push.mjs leaves the Supabase CLI linked to production after the confirmed push** — `scripts/db-push.mjs`:74. Unlink on every exit path (`process.on('exit', () => spawnSync('supabase', ['unlink'], {stdio:'inherit'}))` plus after a successful push), or run link+push against a temporary copy of `supabase/` via `--workdir` so the repo's CLI state never points at prod; pr
- [ ] **[medium] Deck download/export fetch rendered_image_url server-side although the column is owner-writable and un-allowlisted (SSRF with response reflection)** — `app/api/decks/[id]/download/route.ts`:107. Never fetch the stored value: rebuild the URL from `cardRenderPath(owner_id, id)` + the known storage origin, or at minimum gate with `isAllowedServerImageFetchUrl()`, add `AbortSignal.timeout(…)`, and check `content-type` starts with image/ before adding to t
- [ ] **[medium] Deck download/export fetch a user-writable URL (cards.rendered_image_url) server-side with no host allow-list — full-read SSRF** — `app/api/decks/[id]/download/route.ts`:107. Gate both sinks with the existing guard: in download/route.ts and export/route.ts `pngForCard`, treat a `rendered_image_url` that fails `isAllowedServerImageFetchUrl()` as missing (push to `missing` / fall through to the live render) — the bake only ever write
- [ ] **[medium] Set icon upload from the creator is a browser-direct storage write with no moderation scan** — `components/creator/panels/set-icon-panel.tsx`:61. Add a server action mirroring upload-watermark-server.ts (auth, size cap, Sharp sniff/normalize, scanImageUrl, then upload) and call it from SetIconPanel — and from the set/deck cover uploaders; optionally restrict set_icon_url to the app's storage host.
- [ ] **[medium] Unlisted cards are listed on the creator's public profile grid and counted as 'public cards'** — `lib/cards/queries.ts`:700. Decide the contract: either change listPublicCardsByOwner and the profile count to `.eq("visibility", "public")` (matching listMoreFromOwner and the empty-state copy 'hasn't published any cards publicly'), or reword the Unlisted option to 'hidden from the gall
- [ ] **[medium] Satori fetches user-controlled art/watermark/set-icon/pip URLs directly during render — bypasses the SSRF allowlist, no timeout, no size cap** — `lib/render/card-image.tsx`:289. Resolve every remote image to a data URI before `renderCardImage` with an allowlisted, time-boxed fetch (reuse fetchImageAsDataUri/isAllowedServerImageFetchUrl) in a shared prefetch helper called by bake-render, the three card routes and the exports; reject no
- [ ] **[medium] Public /set/[slug] resolves by slug across ALL owners — any user can hijack another user's set URL** — `lib/sets/queries.ts`:251. Before re-enabling sets, either (a) make set slugs globally unique like decks (0055:27) via a migration that adds a global unique index and renames collisions, and change `ensureUniqueSetSlug` to check across all owners; or (b) move the public route to /set/[u
- [ ] **[medium] profiles is anon-readable with `using (true)` and exposes Stripe/billing/admin columns to anyone with the publishable key** — `supabase/migrations/0001_profiles.sql`:63. New migration: split the sensitive columns behind a self-only policy. Simplest path that keeps `select('*')` call sites working: `revoke select on public.profiles from anon, authenticated;` then `grant select (id, username, display_name, bio, avatar_url, banne
- [ ] **[medium] Like hearts revert to 'un-liked' after a successful like on the anonymous-rendered listing pages (gallery, sets, decks, home trending)** — `components/cards/quick-like-button.tsx`:126. Keep a real `useState` for the settled value: `const [settled, setSettled] = useState({liked: initialLiked, count: initialCount})`, feed `useOptimistic(settled, ...)`, and after the action `setSettled({liked: result.liked, count: result.likes_count})`; sync `s
- [ ] **[medium] Dashboard caps every section at 6 cards and there is no 'all cards' view — older private/unlisted cards become unreachable** — `components/creator/dashboard-selectable-sections.tsx`:246. Add a `/dashboard/cards` route (paginated `listMyCards` with visibility filter + search, reusing DashboardSelectableSections' bulk actions) and link each dashboard section header to it ('View all N →'); as a minimum, drop the `.slice(0, 6)` on Drafts or make t
- [ ] **[medium] Comments on unlisted cards: form is shown, insert succeeds, owner is notified — but RLS hides the comment from the owner and every other viewer** — `supabase/migrations/0019_v2_compat.sql`:125. New migration replacing the SELECT policy with `exists (select 1 from public.cards c where c.id = card_id and (c.visibility in ('public','unlisted') or c.owner_id = auth.uid())) or author_id = auth.uid()`; or, if unlisted threads are unwanted, gate the UI + IN

### Low (batch when convenient)

- [ ] Four SEO landing pages render a second <main id="main"> nested inside the AppShell's <main id="main"> (duplicate id, nested main landmark) — `app/(marketing)/mtg-card-maker/page.tsx`:72
- [ ] OG image stays CDN-served after a card goes private; revalidatePath on the route cannot purge it — `app/api/cards/[id]/og/route.ts`:28
- [ ] Webhook claims the Stripe event before processing; a kill mid-handler makes the event unrecoverable — `app/api/stripe/webhook/route.ts`:39
- [ ] Sitemap owner lookup uses an unbounded .in() over up to 5000 owner ids and ignores the query error, silently dropping every card URL when it fails — `app/sitemap.ts`:213
- [ ] Sitemap never lists /pricing even though billing is live and the page is canonical, indexable and linked from nav/footer — `app/sitemap.ts`:43
- [ ] Card-detail hero preview omits the card's watermark (and faceContent) although cardToPreviewData exists — `components/cards/card-detail-content.tsx`:279
- [ ] Create-mode draft timer can re-persist the localStorage draft after a successful save — `components/creator/card-creator-form.tsx`:1433
- [ ] FieldGroup wraps button toolbars in a <label>, so clicking a field's caption/helper text fires the first button — `components/creator/field-group.tsx`:71
- [ ] Grant-credits idempotency key embeds Date.now(), so the documented double-submit dedupe never happens — `lib/admin/user-actions.ts`:89
- [ ] revalidatePath('/api/cards/{id}/og') is a no-op for the CDN cache — a card flipped to private keeps serving its OG image — `lib/cards/actions.ts`:630
- [ ] updateCardAction writes parent_card_id without the existence/self-reference pre-flight createCardAction performs — `lib/cards/actions.ts`:560
- [ ] Bake persists an art-less PNG as a successful, current-version render when the art fetch fails — `lib/cards/bake-render.ts`:136
- [ ] Overlapping bakes for the same card can persist the older render over the newer one — `lib/cards/bake-render.ts`:94
- [ ] Saving a frame-profile override doesn't mark cards without an explicit template stale, though they render with that override — `lib/cards/frame-profile-override-actions.ts`:54
- [ ] Saving a frame layout override never marks cards with no frame_style.template stale, though they render on that template — `lib/cards/frame-profile-override-actions.ts`:54
- [ ] Challenge admin actions never revalidate /challenges/[slug], so 'Close now' / feature toggles leave the detail page stale — `lib/challenges/actions.ts`:51
- [ ] Slug truncation can produce a trailing/double hyphen, failing the decks_slug_format CHECK with a raw Postgres error — `lib/decks/actions.ts`:124
- [ ] Artifact/enchantment lands are bucketed as Artifact/Enchantment, so they enter the mana curve and are excluded from the land count — `lib/decks/analytics.ts`:52
- [ ] Importing a card with Scryfall cmc ≥ 10000 (Gleemax) overflows deck_cards.mana_value numeric(6,2) and aborts the whole import — `lib/decks/import.ts`:232
- [ ] setFeaturedCardAction reports success even when clearing the slot fails — `lib/featured/actions.ts`:68
- [ ] Follow/unfollow toggling spams the target with unlimited 'follow' notifications — `lib/follows/actions.ts`:38
- [ ] resolveCardReportsAction marks reports 'actioned' and toasts 'Card hidden' even if the cards update failed; comment 'remove' likewise ignores the delete result — `lib/moderation/actions.ts`:154
- [ ] Custom-pip rebake sweep only matches the symbol in cost/back_face.cost, but renderers also draw custom pips inline in rules text — `lib/pips/actions.ts`:219
- [ ] Avatar/banner upload deletes the previous object before the new upload succeeds — `lib/profile/upload-server.ts`:149
- [ ] Admin Scryfall dashboard omits deck_import from today/minute/per-action counts but includes it in the 30-day totals — `lib/scryfall/admin-usage-queries.ts`:53
- [ ] Scryfall throttle lets concurrent callers stampede instead of queueing — `lib/scryfall/client.ts`:41
- [ ] Scryfall import drops the Kindred supertype (Scryfall renamed Tribal → Kindred) — `lib/scryfall/import-mapper.ts`:32
- [ ] Single 'Add' inserts at position 0, so after a drag-reorder the new card lands second instead of last — `lib/sets/actions.ts`:487
- [ ] Public set card counts include private cards that the page cannot show — `lib/sets/queries.ts`:87
- [ ] Like and remix notification triggers have no dedupe — toggling like (or private↔public on a remix) generates unbounded duplicate notifications to the owner — `supabase/migrations/0032_notifications.sql`:55
- [ ] handle_new_user passes OAuth full_name/name straight into display_name (CHECK ≤ 64) — a long Google name aborts signup — `supabase/migrations/0046_handle_new_user_oauth.sql`:46
- [ ] feedback.resolved_by is a NO ACTION FK to auth.users — an admin who has resolved feedback can no longer delete their account (regression of the 0031 fix) — `supabase/migrations/0051_feedback_admin_notifications.sql`:29
- [ ] Rebake route's private-card cleanup branch is unreachable — `app/api/admin/rebake/route.ts`:115
- [ ] GET /api/sets/[id]/export (Pro whole-set PDF) is unreachable: no link, no fetch, and the sets flag is off — `app/api/sets/[id]/export/route.ts`:45
- [ ] Forge AI panel hard-wires a 'Coming soon' overlay over a fully built, still-mounted 786-line AI assistant with a live API route — `components/creator/panels/forge-ai-panel.tsx`:27
- [ ] Vestigial template_id is still defaulted, validated and persisted, costing an extra sequential card_templates query on every create/edit render — `components/creator/panels/identity-panel.tsx`:77
- [ ] AiSetGenerator: SET_GENERATION_UI_ENABLED is hard-wired false, leaving ~100 lines of unreachable UI plus hooks that run for the stub — `components/sets/ai-set-generator.tsx`:32
- [ ] SET_GENERATION_ENABLED is hard-wired false — whole set-generation path is flag-dead and hides a latent size-clamp mismatch — `lib/ai/generation-jobs.ts`:212
- [ ] Dead query exports: getCardBySlugPublic, listPublicCards and getCardWithLineage have no callers — `lib/cards/queries.ts`:288
- [ ] Deck and set opengraph-image.tsx are ~110-line clones with brand hex literals hard-coded instead of BRAND tokens (26 literals across the OG page files) — `app/(marketing)/deck/[slug]/opengraph-image.tsx`:87
- [ ] Small pure helpers duplicated: firstString ×3, clamp ×3, randomUUID-fallback snippet ×5 — `app/(marketing)/gallery/gallery-view.tsx`:80
- [ ] Rate-limit 429 + Retry-After response block copy-pasted 10 times across 7 route handlers — `app/api/ai/jobs/route.ts`:215
- [ ] UUID regex declared inline in 17 files alongside two differing validated homes (auth UUID_REGEX vs zod-4 uuidSchema); three different Scryfall-id checks — `app/api/cards/[id]/og/route.ts`:31
- [ ] CRON_SECRET bearer check (isAuthorized) and the service-role 503 guard duplicated in both cron routes and admin/rebake — `app/api/cron/refill-credits/route.ts`:27
- [ ] buildCardPath helper bypassed by ~14 inline `ownerUsername ? /card/u/slug : /card/slug` re-implementations — `components/cards/like-button.tsx`:49
- [ ] Low-credit threshold and tier display name re-derived in two panels instead of coming from lib/billing/plans — `components/dashboard/credits-summary.tsx`:30
- [ ] inputClass/textareaClass Tailwind blobs are exported from field-group.tsx but copied verbatim into deck and set creator forms — `components/decks/deck-creator-form.tsx`:376
- [ ] Sign-in bounce logic copied into five buttons with two drifts: FollowButton drops redirectTo, only QuickLikeButton re-checks the session cookie — `components/follows/follow-button.tsx`:24
- [ ] formatRelative copy-pasted verbatim in 3 components; formatDate duplicated 3× — `components/notifications/notification-bell.tsx`:202
- [ ] Notification row presentation duplicated between the bell and the page; formatRelative copied three times, formatDate twice — `components/notifications/notification-bell.tsx`:29
- [ ] RARITY_LABELS ×3, COLOR_LABEL(S) ×2 and COLOR_DOT ×2 re-declared in components while types/card.ts already hosts CARD_TYPE_LABELS — `components/sets/set-analytics-panel.tsx`:17
- [ ] Analytics panels duplicate BarList (already drifted), COLOR_DOT/COLOR_LABELS, and RARITY_LABELS (three copies, no home in types/card) — `components/sets/set-analytics-panel.tsx`:128
- [ ] UUID regex declared in 20 files (two of them re-created per call inside function bodies) — `lib/auth/schemas.ts`:126
- [ ] Slug generation implemented 4 ways with different normalization (diacritics, caps, fallbacks) — `lib/challenges/actions.ts`:41
- [ ] Owner-username lookup for revalidation re-implemented 8× (cached getCurrentProfile already has it); deck revalidation path lists drift — `lib/decks/membership.ts`:60
- [ ] narrowCard() copy-pasted byte-for-byte into lib/cards, lib/decks and lib/sets query modules (plus the ILIKE escape) — `lib/decks/queries.ts`:51
- [ ] UUID regex literal declared in 17 files (twice re-created per call) alongside zod uuid() elsewhere — `lib/moderation/actions.ts`:105
- [ ] lib/og chrome (WUBRG pip strip, brand lockup, gradient ground, domain stamp) re-inlined in home-card.tsx and card-social.tsx instead of using shell.tsx's OgShell/BrandLockup — with size drift — `lib/og/home-card.tsx`:47
- [ ] card-pdf.ts: buildDeckPdf re-inlines drawSheet's 3×3 grid + crop-mark corner loop; PDF metadata block and one-card-per-page loop also duplicated — `lib/render/card-pdf.ts`:313
- [ ] Like-toggle server action triplicated (self-described 'mirror'); set/deck copies invert the cards' no-purge-on-like policy — `lib/sets/likes.ts`:42
- [ ] Reconcile sweep scans only the oldest 500 spends per daily run with no pagination; stale 'hourly' comment — `lib/billing/credit-reconcile.ts`:41
- [ ] Report actions have no rate limit and no visibility guard; every report sends an admin email + Slack + per-admin notification rows — `lib/moderation/actions.ts`:30
- [ ] Cred-gated e2e specs run against the prod-pointed :3000 dev server when credentials come from the shell instead of .env.e2e — `playwright.config.ts`:49
- [ ] OG route serves the 1500×2100 render to anyone via ?preset=hd, bypassing the viewer-tier gate the PNG route enforces — `app/api/cards/[id]/og/route.ts`:54
- [ ] Public OG image route serves the 1500×2100 'hd' render with no entitlement check, bypassing the Plus/Pro hi-res export gate — `app/api/cards/[id]/og/route.ts`:53
- [ ] Unauthenticated Satori render endpoints (/api/cards/[id]/og and /png) have no rate limit and are trivially cache-busted — `app/api/cards/[id]/og/route.ts`:57
- [ ] Admin grant note is shown verbatim to the end user in their credit ledger — `lib/admin/user-actions.ts`:88
- [ ] Card-capacity gate is check-then-insert with no DB enforcement — `lib/cards/actions.ts`:273
- [ ] lib/cards/bake-render.ts is a 'use server' module whose exports are internal helpers, so they are registered as server actions — `lib/cards/bake-render.ts`:1
- [ ] Pinned-cards read path does not check ownership, so another creator's card can be pinned to your profile — `lib/cards/queries.ts`:668
- [ ] toggleDeckLikeAction revalidates client-supplied paths (deckSlug / ownerUsername are not validated) — `lib/decks/likes.ts`:47
- [ ] Reporter-controlled `details` is interpolated raw into the Slack mrkdwn alert (link/mention injection) — `lib/moderation/notify.ts`:23
- [ ] Custom-pip moderation scans the un-versioned public URL of a cacheable, in-place-overwritten object — `lib/pips/actions.ts`:119
- [ ] No security response headers anywhere (no X-Frame-Options / frame-ancestors, no CSP) — authenticated pages are clickjackable — `next.config.ts`:52
- [ ] card_set_items UPDATE policy omits the card-ownership check its INSERT policy enforces — a set owner can re-point an item at anyone's card — `supabase/migrations/0009_card_sets.sql`:166
- [ ] Zod https/host gating on profile URL columns is not mirrored by DB CHECKs, so direct PostgREST writes bypass it — `supabase/migrations/0022_profile_customization.sql`:53
- [ ] increment_card_view is a SECURITY DEFINER RPC granted to anon — view counts trivially inflatable — `supabase/migrations/0042_card_views_and_ranks.sql`:78
- [ ] increment_card_view / increment_deck_view are anon-callable, unthrottled, and ignore visibility — 'Most viewed' is trivially gameable — `supabase/migrations/0042_card_views_and_ranks.sql`:78
- [ ] deck_likes SELECT policy is `using (true)` — regresses the card_likes/set_likes hardening (0012, 0024) — `supabase/migrations/0055_decks.sql`:296
- [ ] deck_likes SELECT policy is `using (true)` — anyone can enumerate who liked private/unlisted decks (never received the 0012/0024 hardening) — `supabase/migrations/0055_decks.sql`:296
- [ ] deck_likes SELECT is `using (true)` — anonymous callers can enumerate who liked private/unlisted decks (the leak 0012 and 0024 already closed for cards and sets) — `supabase/migrations/0055_decks.sql`:299
- [ ] ai_generation_jobs rows are fully client-writable (plan/steps/kind) and the step route trusts them — `supabase/migrations/0059_ai_generation_jobs.sql`:69
- [ ] No unit coverage for the admin credit-grant / comp / card-cap actions — `lib/admin/user-actions.ts`:61
- [ ] No unit coverage of the credit reserve → refund → spend_ref stamping path in job steps — `lib/ai/generation-jobs.ts`:515
- [ ] Import commit merge/accumulate logic has no tests despite a documented prior data-loss bug — `lib/decks/import.ts`:318
- [ ] No automated coverage at all for the sets subsystem (membership authz, icon denormalization, deferred re-bake, slug uniqueness) — `lib/sets/actions.ts`:333
- [ ] No unit tests for checkout/portal actions or the entitlement resolver — `lib/stripe/actions.ts`:22
- [ ] Challenge e2e specs depend on a migration-seeded challenge that expires 14 days after the migration runs — `tests/e2e/challenges.spec.ts`:18
- [ ] No tests cover the auth redirect guard, middleware session gate, or account deletion — `tests/unit/auth/profile-schema.test.ts`:1
- [ ] Owner's 'View public page' / 'View set' links 404 for private sets because the detail page resolves via the anonymous client — `app/(app)/set/[slug]/edit/page.tsx`:91
- [ ] Legal pages send takedown/privacy requests to a contact channel the About page says does not exist yet (circular dead end) — `app/(marketing)/about/page.tsx`:91
- [ ] Pricing page hero and meta description unconditionally promise a 7-day free trial that checkout refuses to lapsed subscribers — `app/(marketing)/pricing/page.tsx`:51
- [ ] Frame editor copy says Shift is the coarse-nudge modifier; the handler only checks Alt — `components/admin/frame-guide.tsx`:24
- [ ] AI remix dialog promises '10 remixes per day' but the daily cap is skipped whenever billing is enabled — `components/cards/ai-remix-button.tsx`:186
- [ ] Unsaved deck-form edits are silently wiped whenever another panel on the edit page calls router.refresh() — `components/decks/deck-creator-form.tsx`:142
- [ ] FeedbackForm silently does nothing on submit when the ?from= deep-link fails page_url validation — `components/feedback/feedback-form.tsx`:73
- [ ] Pill toggle chips and AI style presets re-implemented instead of using ChipGroup / StylePicker; gallery copy drifted — `components/gallery/gallery-filters.tsx`:422
- [ ] Booster 'Open another pack' re-deals the identical pack — no reshuffle happens — `components/sets/booster-viewer.tsx`:87
- [ ] Three components hand-roll the modal that ui/dialog.tsx exists to replace; their click-outside handler is dead code — `components/sets/delete-set-dialog.tsx`:70
- [ ] Set icon picker accepts SVG files that the uploader and the set-covers bucket both reject — `components/sets/set-creator-form.tsx`:427
- [ ] Billing/usage panels advertise '5/mo on Free' although Free never refills; credit-meter zero-state promises a trial to subscribers — `components/settings/billing-panel.tsx`:78
- [ ] Like/follow toggling creates an unbounded stream of notifications — nothing dedupes or removes them on unlike/unfollow — `supabase/migrations/0032_notifications.sql`:46
- [ ] Deck-entry mutations never touch decks.updated_at, so 'recent' ordering ignores card-list edits — `supabase/migrations/0055_decks.sql`:183
