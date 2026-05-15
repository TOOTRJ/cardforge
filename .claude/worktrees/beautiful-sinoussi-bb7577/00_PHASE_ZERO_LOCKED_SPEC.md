# Phase 0 — Locked Product & Architecture Spec

## Product Name Placeholder

`CardForge`

Final name can change later. The internal architecture should remain brand-neutral.

## One-Sentence Product Definition

CardForge is a modern web platform for creating, saving, exporting, sharing, remixing, and organizing custom trading cards.

## Strategic Positioning

Do not position the app as only an MTG card maker.

Position it as:

> A modern custom trading card design platform, launching first with fantasy card templates inspired by popular tabletop card games.

## MVP Target User

Primary MVP user:

- Casual MTG/custom-card fan
- Commander player
- Meme card creator
- Homebrew designer
- Cube designer
- Fan-set creator

Secondary future user:

- Indie TCG designer
- Board game designer
- Tabletop RPG creator
- Teacher building educational cards
- Creator selling templates/assets

## MVP Core Promise

Users can create a beautiful custom fantasy trading card in under 60 seconds.

## Phase 0 Locked MVP Scope

The MVP includes:

1. Landing page
2. Authentication
3. User dashboard
4. Card creator
5. Live card preview
6. Artwork upload
7. Save card
8. Edit card
9. Public/private visibility
10. Card detail page
11. Public gallery
12. Basic search/filtering
13. PNG export
14. Basic custom sets
15. Basic profile page
16. Like/favorite cards
17. Simple AI helper after core creator works

## Explicitly Out Of MVP

Do not build these before MVP launch:

- Marketplace
- Paid subscriptions
- Stripe billing
- Real-time collaborative editing
- Full drag/drop Figma-style editor
- Full rules engine
- Full game simulator
- Draft simulator
- Mobile app
- Native app
- Plugin system
- Public API
- Advanced card frame scripting
- User-generated templates marketplace
- Print fulfillment
- Official MTG card replicas
- Official mana icons
- Official Wizards branding

## Product Differentiator

The first meaningful differentiation is:

1. Modern UX
2. Fast card creation
3. Structured card data
4. High-quality export
5. Public sharing
6. Remix/fork flow
7. Set organization
8. AI assistance

## Key Product Loop

1. User has an idea.
2. User creates a card.
3. User saves it.
4. User exports or shares it.
5. Other users view/like/remix it.
6. User creates more cards or builds a set.

## Long-Term Product Moat

The moat is not only the editor.

The moat is:

- structured card database
- creator profiles
- remix graph
- public gallery SEO
- set/worldbuilding system
- AI-assisted balancing and templating
- community content library

## Core Data Concepts

### User

A registered account.

### Profile

Public-facing creator identity.

### Game System

A configurable rules/theme system. MVP has one fantasy card system.

### Template

A visual card layout.

### Card

A structured card object with fields and rendering metadata.

### Card Version

Future-ready version history object. May be deferred but schema should not block it.

### Set

A collection of cards.

### Export

A rendered output file.

### Like/Favorite

User engagement with cards.

### Remix

A card derived from another card.

## MVP Card Fields

Required/expected fields:

- id
- owner_id
- title
- slug
- game_system
- template_id
- cost
- color_identity
- supertype
- card_type
- subtypes
- rarity
- rules_text
- flavor_text
- power
- toughness
- loyalty
- defense
- artist_credit
- art_url
- art_position
- frame_style
- visibility
- parent_card_id
- created_at
- updated_at

## Supported MVP Card Types

- Creature
- Spell
- Artifact
- Enchantment
- Land
- Token
- Planeswalker-like advanced type may be added later, not required for first creator

## Visual Direction

The MVP UI should feel:

- modern
- premium
- fast
- fantasy-inspired
- creator-focused
- clean, not cluttered

Avoid copying official card frames.

Use original generic frame designs.

## MVP Navigation

Recommended navigation:

- Home
- Create
- Gallery
- Sets
- Dashboard
- Profile
- Settings

## Landing Page Sections

- Hero
- Create cards fast
- Build custom sets
- Share and remix
- AI-assisted design teaser
- Gallery preview
- CTA

## Dashboard Sections

- Recent cards
- Draft cards
- Public cards
- Sets
- Quick create button

## Creator Layout

Desktop:

- Left: form fields
- Right: live card preview
- Bottom/right actions: save, export, visibility

Mobile:

- Tabs:
  - Details
  - Art
  - Preview
  - Save

## Rendering Strategy

MVP preview:

- React/HTML/CSS/SVG card preview

Export phase:

- server-side rendering to PNG
- Sharp or equivalent export pipeline

Future:

- optional canvas renderer for advanced editing

## Database Strategy

Use Supabase Postgres.

Use RLS from the start.

Store card data as structured columns plus a flexible JSON field for template-specific metadata.

Recommended pattern:

- stable searchable fields as columns
- template/rendering metadata in JSONB

## Storage Strategy

Supabase Storage buckets:

- card-art
- card-exports
- avatars
- set-covers

Use owner-scoped paths.

## Security Requirements

- Users can only edit/delete their own cards.
- Private cards are visible only to owner.
- Public cards are visible to everyone.
- Uploaded files must have size/type restrictions.
- Never trust client-provided user IDs.
- Enforce RLS.

## Legal Disclaimer Requirement

Add a site disclaimer before launch:

"CardForge is an unofficial custom card design and playtesting tool. It is not affiliated with, endorsed by, or sponsored by Wizards of the Coast or any official trading card game publisher. Users are responsible for ensuring they have rights to any uploaded artwork."

## Success Criteria For MVP

MVP is successful when:

1. A user can create an account.
2. A user can create a card.
3. A user can upload art.
4. A user can save/edit a card.
5. A user can download a PNG.
6. A user can publish a card.
7. Public users can view card pages.
8. Users can browse a gallery.
9. Users can organize cards into a set.
10. The app builds cleanly with no TypeScript errors.

## Phase 0 Decision

Locked direction:

> Build a universal custom trading card platform, launching with a polished fantasy-card creator MVP.
