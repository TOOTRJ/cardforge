# TODO

- [x] **Local dev no longer touches production** (2026-09-21). `.env.local`
      → the shared `dev` Supabase branch; `npm run dev` refuses to start
      against prod; prod creds parked in `.env.prod-peek`. Full environment
      rework + audit: docs/ENVIRONMENTS.md.

- [x] **Separate AI Gateway key for Preview + Development** (done 2026-09-21;
      production keeps its original key).

- [x] **`main` ruleset** (2026-09-21): PR-only, required checks `Typecheck, lint,
      unit` / `E2E (local Supabase)` / `Supabase Preview`, admin bypass.

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
      links to `/mtg-card-maker`, `/best-mtg-card-makers`, `/create`,
      `/articles/how-to-print-proxy-mtg-cards`, and a `<Callout>` CTA to
      `/preview` (no account needed). Add the slug to the "Best card makers"
      page's cross-links and to `lib/content/clusters.ts`; regenerate the
      per-article OG image automatically (existing `opengraph-image.tsx`).
      Keep claims verifiable (no invented Card Conjurer bugs); date it and
      set `updated` when Card Conjurer's status changes.

## Audit follow-ups (2026-09-14)

Open findings from the full-site audit (verified). Items already fixed in PRs
#251–#255 are not listed; the full report with evidence is the session's
audit artifact. Numbers in brackets are severities; `file:line` points at
the evidence.

### Critical / high — fixed in PR #256 (`fix/critical-rls`)

- [x] **[critical] Owner-writable/deletable `ai_generation_jobs` rows turned the reconcile cron into a self-serve credit refund** — migration `0073_ai_jobs_service_role_writes.sql` drops the owner UPDATE/DELETE policies; `claim_job_step` / `patch_job_step` are now EXECUTE-able by `service_role` only and the server executor (`lib/ai/generation-jobs.ts`) checks ownership before calling them through the admin client. Owners keep SELECT + INSERT (create a job) only.
- [x] **[high] `profiles` was world-readable including Stripe ids, credits, comp/admin flags** — migration `0074_profiles_billing_columns.sql` revokes table SELECT from `anon`/`authenticated` and grants column-level SELECT on the public columns only; the owner reads their own billing state through the SECURITY DEFINER `get_my_billing()` RPC (`getCurrentProfile` merges it in) and the export watermark decision goes through `owner_export_stamp(p_owner_id)` so public render routes never read billing columns.
- [ ] **[follow-up] Settlement proof still lives in job JSON** — the reconcile cron reads `steps` to decide refunds. With owner writes gone this is no longer exploitable, but a `settle_spend(p_ref)` RPC that stamps `credit_ledger.settled_at` from the executor would make the sweep independent of job rows entirely.

### Medium

- [x] **[medium] Password-reset and confirmation links only work in the browser that requested them (PKCE verifier cookie)** — fixed 2026-09-17 (`fix/auth-audit`): branded templates in `supabase/templates/` link to `/auth/confirm?token_hash=…&type=…`, which verifies on a button press (any browser, scanner-safe). **Owner step:** push the templates to production — `docs/EMAIL.md`.
- [x] (fixed 2026-09-21 — listPublicCardsByOwner + the profile count are public-only) **[medium] Unlisted cards are listed (and counted) on the creator's public profile page** — `app/(marketing)/profile/[username]/page.tsx`:482. Change `listPublicCardsByOwner` and the count query to `.eq("visibility", "public")` (the pinned path at :668 already does), and keep `SHAREABLE_VISIBILITIES` only for the direct-link/OG routes. If unlisted-on-profile was intended, update the publish-panel and
- [x] **[medium] OAuth-provider avatar URLs go through next/image without `unoptimized`, but only Supabase storage hosts are allowlisted** — `components/cards/card-detail-content.tsx`:843. Fixed 2026-09-17 (`feat/onboarding-email`): `unoptimized` added.
- [x] (fixed 2026-09-21 — hero + every tile use cardToPreviewData()) **[medium] Card detail page hand-builds the front-face <CardPreview> bag and omits `watermark`/`faceContent` while importing cardToPreviewData for the back card — live preview diverges from the bake** — `components/cards/card-detail-content.tsx`:279. card-detail-content.tsx: `<CardPreview {...cardToPreviewData(card, profileOverrides)} pipOverrides={pipOverrides} backFace={...} backCard={...} footerWatermark={...} />` once cardToPreviewData carries backFace (see dup-01 fix). set-card-sortable.tsx: `<CardPre
- [ ] **[medium] Leaving an Adventure/Split/Flip/Aftermath kind never clears has_back_face — standard frames then can't save or persist a phantom back face** — `components/creator/card-creator-form.tsx`:778. In applyKindPatch, when `!KIND_DEFS[nextKind].inlineSecondFace` and the previous template `hasInlineBackFace`, `setValue("has_back_face", false)` and reset `back_face` to EMPTY_BACK_FACE; additionally make runSubmit send `back_face: null` unless `hasInlineBack
- [x] (fixed 2026-09-21 — seeded rows capped at 6; unrendered server field errors become the toast) **[medium] Server field errors on keys no panel renders (face_content, back_card_id) are swallowed; 7-row planeswalker can never be saved** — `components/creator/card-creator-form.tsx`:1401. Mirror the counts in cardFormSchema (issue on `loyalty_abilities`/`saga_chapters` when surviving rows > 6), cap seeded rows at 6 in the kind-switch seeding, and in applyFieldErrors fall back to `setServerError`/toast for any key `buildFieldToStep()` does not m
- [x] (fixed 2026-09-21 — CardCreatorForm keyed on the flow (backFor / deck remix / remix parent)) **[medium] 'Create a new card' for the back face navigates /create → /create?backFor= without remounting the form** — `components/creator/card-creator-form.tsx`:1483. Key the form on the flow in create/page.tsx (`key={backFor?.id ?? deckRemix?.deckCardId ?? "new"}`), or add an effect in the form that `reset(defaults)` + `goToIndex(0)` when `backForCardId` changes and skips the pending draft write.
- [x] (fixed 2026-09-21 — schemas accept null; the edit form sends null for an emptied field) **[medium] Deck edit cannot clear the description or remove the cover — 'Changes saved' but nothing changes** — `components/decks/deck-creator-form.tsx`:153. Give the wire format an explicit 'clear' value: make `deckDescriptionSchema`/`deckCoverUrlSchema` `.nullable()` (e.g. `optionalEmptyString(schema).or(z.null())`) and have the form send `null` (not `undefined`) when the trimmed input is empty in edit mode; `upd
- [ ] **[medium] Gallery search/filter changes keep a stale ?page while the sets/decks search copies reset it** — `components/gallery/gallery-filters.tsx`:88. Extract `useSearchParamPatch()` (sets/deletes keys, always deletes 'page', router.replace with scroll:false) into lib/routing/use-search-param-patch.ts and use it in gallery-filters, sets-search and decks-search.
- [x] (fixed 2026-09-21 — migration 0098 SELECT policy: readable wherever the card is (public/unlisted, or owner), or by author) **[medium] Comments are accepted on unlisted cards but the SELECT policy only exposes comments on public cards** — `lib/cards/comments-actions.ts`:104. Add a migration that drops and recreates the SELECT policy with `c.visibility in ('public','unlisted')` (link-holders and the owner can read/moderate), or alternatively reject unlisted in createCommentAction and hide the composer on unlisted pages — but keep t
- [ ] **[medium] Comments on UNLISTED cards are invisible to the card owner (and every non-author viewer) yet still fire an owner notification** — `lib/cards/comments-actions.ts`:104. New migration replacing the 0019 SELECT policy with `exists (select 1 from public.cards c where c.id = card_id and (c.visibility in ('public','unlisted') or c.owner_id = auth.uid())) or author_id = auth.uid()` — i.e. comments readable wherever the card is read
- [x] (fixed 2026-09-21 — resolveCardReportsAction → purgeHiddenCard(): card/profile/gallery paths + OG route + CDN tag purge) **[medium] Admin 'Hide card' does not purge the card's cached surfaces or the CDN-cached OG image, unlike the owner-side private flip** — `lib/moderation/actions.ts`:178. Export `revalidateCardPaths`/`revalidateDiscoverySurfaces` (or a `purgeCardEverywhere(cardId, slug, ownerUsername)` helper) from lib/cards/actions.ts and call it from the hide branch, including `revalidatePath(`/api/cards/${cardId}/og`)`; select `slug` and the
- [x] (fixed 2026-09-21 — 0098: uniqueness is per PENDING report (partial unique index); 23505 now only means a duplicate open report) **[medium] Re-reporting a card/comment after its earlier report was dismissed/actioned is silently swallowed as success (owner can re-publish a hidden card unflagged)** — `lib/moderation/actions.ts`:48. Replace the plain UNIQUE with a partial unique index `where status = 'pending'` (migration), and on 23505 (now only true duplicates) keep the idempotent success. Alternatively, on conflict do `update ... set status='pending', reason=..., created_at=now() where
- [x] (fixed 2026-09-21 — scan happens before the canonical object is touched; a flagged image leaves the approved pip intact) **[medium] Flagged custom-pip upload deletes the owner's previously approved pip object but leaves the custom_pips row pointing at it** — `lib/pips/actions.ts`:121. Moderate before overwriting the canonical object: scan the normalized PNG bytes (base64 data URL) or upload to a temp path, scan, then copy to the canonical path; only upsert the object + row after the scan passes, leaving an existing approved pip untouched on
- [x] (fixed 2026-09-21 — checklist embeds MPlantin via @pdf-lib/fontkit; unencodable code points → '?') **[medium] Deck export 500s whenever a deck title or card name contains a non-WinAnsi character** — `lib/render/card-pdf.ts`:338. Embed a Unicode-capable TTF for the checklist (register `@pdf-lib/fontkit` and `doc.embedFont(<Beleren/MPlantin bytes from lib/render/card-fonts.ts>)`), or sanitize heading/lines by replacing characters Helvetica cannot encode; also cap the heading length.
- [ ] **[medium] Set editor cannot clear cover, icon, or description — 'Remove'/'Use default' save as silent no-ops** — `lib/sets/actions.ts`:210. Same fix as bugs-b-01: make the four optional string schemas accept `null` as an explicit clear, have the form send `null` for emptied fields in edit mode, and keep `update.x = data.x ?? null`. The `iconChanged` computation then works unchanged and triggers th
- [ ] **[medium] deleteSetAction leaves every member card rendering the deleted set's symbol (stale set_icon_url/set_icon_code, no re-bake)** — `lib/sets/actions.ts`:302. In `deleteSetAction`, before the delete, select `cards.id` where `primary_set_id = setId`, then for each either re-home to the oldest remaining membership (reuse `repointPrimaryAfterRemoval`) or clear `set_icon_url`/`set_icon_code`, and schedule the deferred b
- [ ] **[medium] build-variation-frames.mjs writes the Expedition frame to public/frames/expedition, but the shipped template is expeditionland** — `scripts/build-variation-frames.mjs`:90. Change scripts/build-variation-frames.mjs:90 to `out: "public/frames/expeditionland"` and the header at :7 to `expeditionland`.
- [x] (fixed 2026-09-21 — 0100 ports the 0057 guard to cards (view_count/likes_count/share_count no longer bump updated_at)) **[medium] cards.updated_at is bumped by every view and like — gallery 'Recent' sort means 'recently viewed' (the 0057 deck fix was never applied to cards)** — `supabase/migrations/0003_card_data_model.sql`:160. New migration porting the 0057 guard into set_cards_updated_at: `if (to_jsonb(new) - 'view_count' - 'likes_count' - 'updated_at') is distinct from (to_jsonb(old) - ...) then new.updated_at = now(); else new.updated_at = old.updated_at; end if;`. Note in the PR
- [x] **[medium] (fixed 2026-09-21 — seed.sql seeds prod's verified frames, seeds/10_dev_data.sql the rest) seed.sql claims no baseline rows are required, but an empty frame_reviews table leaves the creator with zero pickable frames on every preview branch and fresh local stack** — `supabase/seed.sql`:11. Replace L11-14 with:
-- Baseline rows: frame_reviews. Frame verification is the ONLY gate the creator
-- has (lib/cards/frame-availability.ts) — with this table empty, /create offers
-- no frames and every card kind renders as "Soon". Seed the verified
-- (tem
- [ ] **[medium] Homepage pricing strip sells 'the AI set generator' and 'premium finishes' as paid perks that plans.ts says are not live (and finishes are explicitly a Free-tier feature)** — `app/(marketing)/page.tsx`:126. Derive the homepage blurb from PLANS (credits, watermark-free hi-res exports, capacity) and drop the two coming-soon perks; align faq.ts:164 and :244 with plans.ts.
- [x] (fixed 2026-09-21 — §3 names Stripe, Resend, the AI Gateway providers (Anthropic, Black Forest Labs, Google), OpenAI moderation, Slack) **[medium] Privacy page omits Stripe, OpenAI (upload moderation) and the image-generation providers the code actually sends data to** — `app/(marketing)/privacy/page.tsx`:65. Add Stripe (billing; email + payment handled by Stripe), OpenAI (automatic moderation scan of uploaded images), and the Vercel AI Gateway image providers (Black Forest Labs, Google) to §3; reword the Anthropic bullet so it doesn't imply AI providers are contac
- [x] (fixed 2026-09-21 — feature-grid tile → Decks and proxies; free-account FAQ says 'build decks') **[medium] Marketing copy and FAQPage JSON-LD advertise the Sets feature as shipped while it is feature-flagged off (/sets 404s, nav hidden, 'Custom sets' listed as coming soon)** — `lib/content/faq.ts`:39. Gate every sets claim on isSetsEnabled() (or rewrite to 'decks'), regenerate the FAQPage JSON-LD from the gated list, and keep marketing copy in sync with PAID_COMING_SOON.
- [x] (fixed 2026-09-21 — answers describe FLUX via the AI Gateway, 'Generate with AI', credits, 'Get ideas') **[medium] AI generator FAQ (also emitted as FAQPage JSON-LD) describes an OpenAI image model, a 10-per-day quota, a BYO-OpenAI-key roadmap and a 'Generate random card' button — none match the code** — `lib/content/faq.ts`:97. Rewrite the AI_GENERATOR_FAQ answers to describe the AI Gateway providers, the credits model (5 free credits, then plans/packs), and the 'Generate with AI' dialog; drop the BYO-key sentence; keep faq.ts as the single source so JSON-LD follows.
- [ ] **[medium] admin/rebake re-inlines bake-render.ts's upload → getPublicUrl → ?v= → row-update sequence and the private-card cleanup; the copy dropped the retry + leak log** — `app/api/admin/rebake/route.ts`:136. Move `uploadRenderAndPersist(supabase, path, pngBytes, cardId)` and export `removeRenderObject` from lib/cards/bake-core.ts (its stated purpose is shared bake plumbing); bake-render.ts and rebake/route.ts both call them so the retry+log applies to rebake.
- [x] (fixed 2026-09-21 — all six remaining literals replaced with cardToPreviewData()) **[medium] Nine card-tile previewData literals duplicate cardToPreviewData and all omit watermark/faceContent** — `components/cards/gallery-card-tile.tsx`:64. Replace each literal with `previewData={cardToPreviewData(card, profileOverrides)}` (cardToPreviewData already accepts Card; trending/gallery tiles pass profileOverrides where they have it).
- [x] (fixed 2026-09-21 — `supabase unlink` on every exit path) **[medium] db-push.mjs leaves the Supabase CLI linked to production after the confirmed push** — `scripts/db-push.mjs`:74. Unlink on every exit path (`process.on('exit', () => spawnSync('supabase', ['unlink'], {stdio:'inherit'}))` plus after a successful push), or run link+push against a temporary copy of `supabase/` via `--workdir` so the repo's CLI state never points at prod; pr
- [x] (fixed 2026-09-21 — lib/sets/upload-cover-server.ts: Sharp-validated, session-owned, NSFW-scanned; uploadSetCover() is now a thin client wrapper) **[medium] Set icon upload from the creator is a browser-direct storage write with no moderation scan** — `components/creator/panels/set-icon-panel.tsx`:61. Add a server action mirroring upload-watermark-server.ts (auth, size cap, Sharp sniff/normalize, scanImageUrl, then upload) and call it from SetIconPanel — and from the set/deck cover uploaders; optionally restrict set_icon_url to the app's storage host.
- [ ] **[medium] Unlisted cards are listed on the creator's public profile grid and counted as 'public cards'** — `lib/cards/queries.ts`:700. Decide the contract: either change listPublicCardsByOwner and the profile count to `.eq("visibility", "public")` (matching listMoreFromOwner and the empty-state copy 'hasn't published any cards publicly'), or reword the Unlisted option to 'hidden from the gall
- [ ] **[medium] Public /set/[slug] resolves by slug across ALL owners — any user can hijack another user's set URL** — `lib/sets/queries.ts`:251. Before re-enabling sets, either (a) make set slugs globally unique like decks (0055:27) via a migration that adds a global unique index and renames collisions, and change `ensureUniqueSetSlug` to check across all owners; or (b) move the public route to /set/[u
- [x] (fixed 2026-09-21 — useOptimistic is based on a settled useState the action result updates) **[medium] Like hearts revert to 'un-liked' after a successful like on the anonymous-rendered listing pages (gallery, sets, decks, home trending)** — `components/cards/quick-like-button.tsx`:126. Keep a real `useState` for the settled value: `const [settled, setSettled] = useState({liked: initialLiked, count: initialCount})`, feed `useOptimistic(settled, ...)`, and after the action `setSettled({liked: result.liked, count: result.likes_count})`; sync `s
- [ ] **[medium] Dashboard caps every section at 6 cards and there is no 'all cards' view — older private/unlisted cards become unreachable** — `components/creator/dashboard-selectable-sections.tsx`:246. Add a `/dashboard/cards` route (paginated `listMyCards` with visibility filter + search, reusing DashboardSelectableSections' bulk actions) and link each dashboard section header to it ('View all N →'); as a minimum, drop the `.slice(0, 6)` on Drafts or make t
- [ ] **[medium] Comments on unlisted cards: form is shown, insert succeeds, owner is notified — but RLS hides the comment from the owner and every other viewer** — `supabase/migrations/0019_v2_compat.sql`:125. New migration replacing the SELECT policy with `exists (select 1 from public.cards c where c.id = card_id and (c.visibility in ('public','unlisted') or c.owner_id = auth.uid())) or author_id = auth.uid()`; or, if unlisted threads are unwanted, gate the UI + IN

### Low (batch when convenient)

- [ ] Four SEO landing pages render a second <main id="main"> nested inside the AppShell's <main id="main"> (duplicate id, nested main landmark) — `app/(marketing)/mtg-card-maker/page.tsx`:72
- [x] (fixed 2026-09-21 — OG responses carry Vercel-Cache-Tag: card-<id>; lib/cards/cache-purge.ts dangerouslyDeleteByTag on private/delete/hide) OG image stays CDN-served after a card goes private; revalidatePath on the route cannot purge it — `app/api/cards/[id]/og/route.ts`:28
- [x] (fixed 2026-09-21 — 0099: claims start unprocessed, stamped after the handler; stale (>10 min) claims are taken over and re-run) Webhook claims the Stripe event before processing; a kill mid-handler makes the event unrecoverable — `app/api/stripe/webhook/route.ts`:39
- [ ] Sitemap owner lookup uses an unbounded .in() over up to 5000 owner ids and ignores the query error, silently dropping every card URL when it fails — `app/sitemap.ts`:213
- [ ] Sitemap never lists /pricing even though billing is live and the page is canonical, indexable and linked from nav/footer — `app/sitemap.ts`:43
- [x] (fixed 2026-09-21 — dup — same fix) Card-detail hero preview omits the card's watermark (and faceContent) although cardToPreviewData exists — `components/cards/card-detail-content.tsx`:279
- [ ] Create-mode draft timer can re-persist the localStorage draft after a successful save — `components/creator/card-creator-form.tsx`:1433
- [x] (fixed 2026-09-21 — the label forwards caption clicks only to input/textarea/select) FieldGroup wraps button toolbars in a <label>, so clicking a field's caption/helper text fires the first button — `components/creator/field-group.tsx`:71
- [x] (fixed 2026-09-21 — key = a per-form requestId minted client-side and rotated after each success) Grant-credits idempotency key embeds Date.now(), so the documented double-submit dedupe never happens — `lib/admin/user-actions.ts`:89
- [ ] revalidatePath('/api/cards/{id}/og') is a no-op for the CDN cache — a card flipped to private keeps serving its OG image — `lib/cards/actions.ts`:630
- [x] (fixed 2026-09-21 — same pre-flight in updateCardAction) updateCardAction writes parent_card_id without the existence/self-reference pre-flight createCardAction performs — `lib/cards/actions.ts`:560
- [x] (fixed 2026-09-21 — bake pre-resolves the art and refuses to render without it) Bake persists an art-less PNG as a successful, current-version render when the art fetch fails — `lib/cards/bake-render.ts`:136
- [x] (fixed 2026-09-21 — freshness check before upload + compare-and-set on updated_at when persisting) Overlapping bakes for the same card can persist the older render over the newer one — `lib/cards/bake-render.ts`:94
- [x] (fixed 2026-09-21 — the default template's override also matches NULL-template rows) Saving a frame-profile override doesn't mark cards without an explicit template stale, though they render with that override — `lib/cards/frame-profile-override-actions.ts`:54

### Deferred by owner decision (2026-09-14) — do not implement yet

- [x] **Email delivery for admin → user messages.** Done 2026-09-17 (`feat/onboarding-email`): branded team-message email gated by the user's "Account & team messages" preference (default on), plus the daily activity digest and the newsletter — `docs/EMAIL.md`. Owner steps: `RESEND_API_KEY` + verified `EMAIL_FROM` in Vercel.
- [ ] **Optional Stripe webhook events for subscriber UX.** The six events the webhook handles today (`checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.created/updated/deleted`, `invoice.payment_failed`) are all that correctness needs. Add these only together with a handler + email: `customer.subscription.trial_will_end` (3-day "your trial ends, card on file?" reminder), `charge.dispute.created` (admin alert so a dispute is answered inside Stripe's window), `invoice.upcoming` (annual-renewal heads-up). `invoice.paid` is NOT needed — `customer.subscription.updated` already carries the renewed period.
- [x] (fixed 2026-09-21 — dup — same fix) Saving a frame layout override never marks cards with no frame_style.template stale, though they render on that template — `lib/cards/frame-profile-override-actions.ts`:54
- [x] (fixed 2026-09-21 — revalidateChallengeSurfaces purges /challenges/[slug]) Challenge admin actions never revalidate /challenges/[slug], so 'Close now' / feature toggles leave the detail page stale — `lib/challenges/actions.ts`:51
- [x] (fixed 2026-09-21 — suffix candidates trim trailing hyphens (decks and cards)) Slug truncation can produce a trailing/double hyphen, failing the decks_slug_format CHECK with a raw Postgres error — `lib/decks/actions.ts`:124
- [x] (fixed 2026-09-21 — Land matched first in typeBucketFor) Artifact/enchantment lands are bucketed as Artifact/Enchantment, so they enter the mana curve and are excluded from the land count — `lib/decks/analytics.ts`:52
- [x] (fixed 2026-09-21 — clampManaValue() to 9999.99) Importing a card with Scryfall cmc ≥ 10000 (Gleemax) overflows deck_cards.mana_value numeric(6,2) and aborts the whole import — `lib/decks/import.ts`:232
- [x] (fixed 2026-09-21 — delete error is checked) setFeaturedCardAction reports success even when clearing the slot fails — `lib/featured/actions.ts`:68
- [x] (fixed 2026-09-21 — dup — 0101, see above) Follow/unfollow toggling spams the target with unlimited 'follow' notifications — `lib/follows/actions.ts`:38
- [x] (fixed 2026-09-21 — every moderation write checks its error; reports are only actioned after the hide succeeds) resolveCardReportsAction marks reports 'actioned' and toasts 'Card hidden' even if the cards update failed; comment 'remove' likewise ignores the delete result — `lib/moderation/actions.ts`:154
- [x] (fixed 2026-09-21 — sweep matches rules_text on both faces too) Custom-pip rebake sweep only matches the symbol in cost/back_face.cost, but renderers also draw custom pips inline in rules text — `lib/pips/actions.ts`:219
- [x] (fixed 2026-09-21 — previous object removed only after upload + scan + row update succeed; a failed row update removes the NEW object) Avatar/banner upload deletes the previous object before the new upload succeeds — `lib/profile/upload-server.ts`:149
- [ ] Admin Scryfall dashboard omits deck_import from today/minute/per-action counts but includes it in the 30-day totals — `lib/scryfall/admin-usage-queries.ts`:53
- [x] (fixed 2026-09-21 — throttle() is a promise chain — callers really queue) Scryfall throttle lets concurrent callers stampede instead of queueing — `lib/scryfall/client.ts`:41
- [ ] Scryfall import drops the Kindred supertype (Scryfall renamed Tribal → Kindred) — `lib/scryfall/import-mapper.ts`:32
- [ ] Single 'Add' inserts at position 0, so after a drag-reorder the new card lands second instead of last — `lib/sets/actions.ts`:487
- [ ] Public set card counts include private cards that the page cannot show — `lib/sets/queries.ts`:87
- [x] (fixed 2026-09-21 — 0101: like/follow notify once per actor/target/24h; unlike/unfollow retracts the unread row) Like and remix notification triggers have no dedupe — toggling like (or private↔public on a remix) generates unbounded duplicate notifications to the owner — `supabase/migrations/0032_notifications.sql`:55
- [ ] handle_new_user passes OAuth full_name/name straight into display_name (CHECK ≤ 64) — a long Google name aborts signup — `supabase/migrations/0046_handle_new_user_oauth.sql`:46
- [x] (fixed 2026-09-21 — 0102: on delete set null) feedback.resolved_by is a NO ACTION FK to auth.users — an admin who has resolved feedback can no longer delete their account (regression of the 0031 fix) — `supabase/migrations/0051_feedback_admin_notifications.sql`:29
- [ ] Rebake route's private-card cleanup branch is unreachable — `app/api/admin/rebake/route.ts`:115
- [ ] GET /api/sets/[id]/export (Pro whole-set PDF) is unreachable: no link, no fetch, and the sets flag is off — `app/api/sets/[id]/export/route.ts`:45
- [ ] Unreachable `/card/${slug}` fallback branches in LikeButton, RemixButton and CardComments point at a route deleted in May — `components/cards/like-button.tsx`:51
- [ ] Forge AI panel hard-wires a 'Coming soon' overlay over a fully built, still-mounted 786-line AI assistant with a live API route — `components/creator/panels/forge-ai-panel.tsx`:27
- [ ] Vestigial template_id is still defaulted, validated and persisted, costing an extra sequential card_templates query on every create/edit render — `components/creator/panels/identity-panel.tsx`:77
- [ ] AiSetGenerator: SET_GENERATION_UI_ENABLED is hard-wired false, leaving ~100 lines of unreachable UI plus hooks that run for the stub — `components/sets/ai-set-generator.tsx`:32
- [ ] SET_GENERATION_ENABLED is hard-wired false — whole set-generation path is flag-dead and hides a latent size-clamp mismatch — `lib/ai/generation-jobs.ts`:212
- [ ] Dead query exports: getCardBySlugPublic, listPublicCards and getCardWithLineage have no callers — `lib/cards/queries.ts`:288
- [x] (fixed 2026-09-21 — dup — same fix) Homepage and FAQ still sell 'set building' and 'the AI set generator' while both are switched off — `app/(marketing)/page.tsx`:128
- [ ] VisibilityPicker + VISIBILITY_OPTIONS copied into set and deck forms (bypassing ChipGroup); set copy's description is stale — `components/sets/set-creator-form.tsx`:70
- [ ] Deck and set opengraph-image.tsx are ~110-line clones with brand hex literals hard-coded instead of BRAND tokens (26 literals across the OG page files) — `app/(marketing)/deck/[slug]/opengraph-image.tsx`:87
- [ ] Small pure helpers duplicated: firstString ×3, clamp ×3, randomUUID-fallback snippet ×5 — `app/(marketing)/gallery/gallery-view.tsx`:80
- [ ] Rate-limit 429 + Retry-After response block copy-pasted 10 times across 7 route handlers — `app/api/ai/jobs/route.ts`:215
- [ ] UUID regex declared inline in 17 files alongside two differing validated homes (auth UUID_REGEX vs zod-4 uuidSchema); three different Scryfall-id checks — `app/api/cards/[id]/og/route.ts`:31
- [ ] CRON_SECRET bearer check (isAuthorized) and the service-role 503 guard duplicated in both cron routes and admin/rebake — `app/api/cron/refill-credits/route.ts`:27
- [ ] buildCardPath helper bypassed by ~14 inline `ownerUsername ? /card/u/slug : /card/slug` re-implementations — `components/cards/like-button.tsx`:49
- [x] (fixed 2026-09-21 — plans.isLowCredits() (≤20% of the monthly allotment, min 1) + planForTier().name in both panels) Low-credit threshold and tier display name re-derived in two panels instead of coming from lib/billing/plans — `components/dashboard/credits-summary.tsx`:30
- [ ] inputClass/textareaClass Tailwind blobs are exported from field-group.tsx but copied verbatim into deck and set creator forms — `components/decks/deck-creator-form.tsx`:376
- [x] (fixed 2026-09-21 — FollowButton bounces with redirectTo and promotes on a session cookie (the drift part; consolidation stays open)) Sign-in bounce logic copied into five buttons with two drifts: FollowButton drops redirectTo, only QuickLikeButton re-checks the session cookie — `components/follows/follow-button.tsx`:24
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
- [x] (fixed 2026-09-21 — pages through the window (20 × 500)) Reconcile sweep scans only the oldest 500 spends per daily run with no pagination; stale 'hourly' comment — `lib/billing/credit-reconcile.ts`:41
- [x] (fixed 2026-09-21 — REPORTS_PER_DAY=20 per reporter; target must be visible to the reporter (RLS)) Report actions have no rate limit and no visibility guard; every report sends an admin email + Slack + per-admin notification rows — `lib/moderation/actions.ts`:30
- [ ] Cred-gated e2e specs run against the prod-pointed :3000 dev server when credentials come from the shell instead of .env.e2e — `playwright.config.ts`:49
- [ ] build-era-frames.mjs default run emits a public/frames/future asset set that no template references — `scripts/build-era-frames.mjs`:119
- [x] (fixed 2026-09-21 — OG route no longer reads ?preset — always the 750×1050 display render) OG route serves the 1500×2100 render to anyone via ?preset=hd, bypassing the viewer-tier gate the PNG route enforces — `app/api/cards/[id]/og/route.ts`:54
- [x] (fixed 2026-09-21 — dup — same fix as the line above) Public OG image route serves the 1500×2100 'hd' render with no entitlement check, bypassing the Plus/Pro hi-res export gate — `app/api/cards/[id]/og/route.ts`:53
- [x] (fixed 2026-09-21 — OG: any ?v other than the card's updated_at 308s to the canonical URL, so a card has 2 cacheable URLs per variant; /png is already private-cached + gated) Unauthenticated Satori render endpoints (/api/cards/[id]/og and /png) have no rate limit and are trivially cache-busted — `app/api/cards/[id]/og/route.ts`:57
- [ ] Admin grant note is shown verbatim to the end user in their credit ledger — `lib/admin/user-actions.ts`:88
- [ ] Card-capacity gate is check-then-insert with no DB enforcement — `lib/cards/actions.ts`:273
- [ ] lib/cards/bake-render.ts is a 'use server' module whose exports are internal helpers, so they are registered as server actions — `lib/cards/bake-render.ts`:1
- [ ] Pinned-cards read path does not check ownership, so another creator's card can be pinned to your profile — `lib/cards/queries.ts`:668
- [ ] toggleDeckLikeAction revalidates client-supplied paths (deckSlug / ownerUsername are not validated) — `lib/decks/likes.ts`:47
- [x] (fixed 2026-09-21 — escapeSlackText() on details/context) Reporter-controlled `details` is interpolated raw into the Slack mrkdwn alert (link/mention injection) — `lib/moderation/notify.ts`:23
- [x] (fixed 2026-09-21 — bytes are staged under a pending name, the VERSIONED pending URL is scanned, then the canonical object is written) Custom-pip moderation scans the un-versioned public URL of a cacheable, in-place-overwritten object — `lib/pips/actions.ts`:119
- [x] (fixed 2026-09-21 — next.config headers(): frame-ancestors 'none' + X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy (no full CSP yet)) No security response headers anywhere (no X-Frame-Options / frame-ancestors, no CSP) — authenticated pages are clickjackable — `next.config.ts`:52
- [ ] card_set_items UPDATE policy omits the card-ownership check its INSERT policy enforces — a set owner can re-point an item at anyone's card — `supabase/migrations/0009_card_sets.sql`:166
- [ ] Zod https/host gating on profile URL columns is not mirrored by DB CHECKs, so direct PostgREST writes bypass it — `supabase/migrations/0022_profile_customization.sql`:53
- [ ] increment_card_view is a SECURITY DEFINER RPC granted to anon — view counts trivially inflatable — `supabase/migrations/0042_card_views_and_ranks.sql`:78
- [ ] increment_card_view / increment_deck_view are anon-callable, unthrottled, and ignore visibility — 'Most viewed' is trivially gameable — `supabase/migrations/0042_card_views_and_ranks.sql`:78
- [x] (fixed 2026-09-21 — 0102: readable when the deck is visible, or own likes) deck_likes SELECT policy is `using (true)` — regresses the card_likes/set_likes hardening (0012, 0024) — `supabase/migrations/0055_decks.sql`:296
- [x] (fixed 2026-09-21 — dup — 0102) deck_likes SELECT policy is `using (true)` — anyone can enumerate who liked private/unlisted decks (never received the 0012/0024 hardening) — `supabase/migrations/0055_decks.sql`:296
- [x] (fixed 2026-09-21 — dup — 0102) deck_likes SELECT is `using (true)` — anonymous callers can enumerate who liked private/unlisted decks (the leak 0012 and 0024 already closed for cards and sets) — `supabase/migrations/0055_decks.sql`:299
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
- [x] (fixed 2026-09-21 — copy now says first-time subscribers; PricingPlans already switched the CTA on hasSubscribed) Pricing page hero and meta description unconditionally promise a 7-day free trial that checkout refuses to lapsed subscribers — `app/(marketing)/pricing/page.tsx`:51
- [ ] Frame editor copy says Shift is the coarse-nudge modifier; the handler only checks Alt — `components/admin/frame-guide.tsx`:24
- [x] (fixed 2026-09-21 — reset(defaults) only when the form isn't dirty) Unsaved deck-form edits are silently wiped whenever another panel on the edit page calls router.refresh() — `components/decks/deck-creator-form.tsx`:142
- [x] (fixed 2026-09-21 — invalid ?from= is dropped, other schema issues surface as a form error) FeedbackForm silently does nothing on submit when the ?from= deep-link fails page_url validation — `components/feedback/feedback-form.tsx`:73
- [ ] Pill toggle chips and AI style presets re-implemented instead of using ChipGroup / StylePicker; gallery copy drifted — `components/gallery/gallery-filters.tsx`:422
- [ ] Booster 'Open another pack' re-deals the identical pack — no reshuffle happens — `components/sets/booster-viewer.tsx`:87
- [ ] Three components hand-roll the modal that ui/dialog.tsx exists to replace; their click-outside handler is dead code — `components/sets/delete-set-dialog.tsx`:70
- [ ] Set icon picker accepts SVG files that the uploader and the set-covers bucket both reject — `components/sets/set-creator-form.tsx`:427
- [x] (fixed 2026-09-21 — premise obsolete (Free refills 5/mo); credit-meter zero state now says 'get more' — the upgrade modal explains trial eligibility) Billing/usage panels advertise '5/mo on Free' although Free never refills; credit-meter zero-state promises a trial to subscribers — `components/settings/billing-panel.tsx`:78
- [x] (fixed 2026-09-21 — dup — 0101, see above) Like/follow toggling creates an unbounded stream of notifications — nothing dedupes or removes them on unlike/unfollow — `supabase/migrations/0032_notifications.sql`:46
- [ ] Deck-entry mutations never touch decks.updated_at, so 'recent' ordering ignores card-list edits — `supabase/migrations/0055_decks.sql`:183
