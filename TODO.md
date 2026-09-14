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
