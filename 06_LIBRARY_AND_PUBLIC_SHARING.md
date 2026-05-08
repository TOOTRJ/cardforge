# Phase 6 — Library, Gallery & Public Sharing

## Goal

Turn the creator into a lightweight content platform.

## Scope

Build:

- dashboard card library
- public gallery
- public card detail page
- profile card list
- likes/favorites
- search/filtering
- remix/copy card flow

## Pages

Update/create:

- `/dashboard`
- `/gallery`
- `/card/[slug]`
- `/profile/[username]`

## Features

### Dashboard Library

Authenticated users can see:

- all their cards
- drafts/private cards
- public cards
- edit/delete actions

### Public Gallery

Visitors can browse:

- recent public cards
- popular cards
- filter by type
- filter by rarity
- search by title/text

### Public Card Page

Show:

- card image/preview
- title
- creator
- created date
- rarity/type
- rules text
- like/favorite button
- remix button

### Likes/Favorites

Database table:

- card_likes
  - user_id
  - card_id
  - created_at

Unique:

- user_id + card_id

### Remix

Authenticated user can copy a public card into their own library.

Set:

- parent_card_id = original card id

## Acceptance Criteria

- Public gallery works.
- Public card pages work.
- Private cards are protected.
- Users can like/unlike.
- Users can remix public cards.
- Dashboard library works.
- Build passes.

## Claude Instruction

Implement Phase 6 only. Do not build sets yet except links/placeholders.
