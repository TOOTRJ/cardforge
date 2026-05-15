# Phase 1 — App Foundation

## Goal

Create the base Next.js application with a clean, production-ready structure.

## Scope

Build:

- Next.js App Router project
- TypeScript strict mode
- Tailwind CSS
- shadcn/ui setup
- base layout
- marketing homepage
- dashboard shell
- global navigation
- responsive styling
- theme tokens
- placeholder pages

## Pages

Create:

- `/`
- `/create`
- `/dashboard`
- `/gallery`
- `/sets`
- `/settings`
- `/profile/[username]`
- `/card/[slug]`
- `/set/[slug]`

For this phase, pages may use placeholder data.

## Design Direction

Use a premium fantasy creator feel:

- dark mode first
- clean cards
- subtle gradients
- strong CTA
- elegant typography
- responsive layout

Do not use official MTG assets.

## Required Components

Create reusable components:

- `SiteHeader`
- `SiteFooter`
- `AppShell`
- `DashboardShell`
- `PageHeader`
- `EmptyState`
- `CardPreviewPlaceholder`
- `MarketingHero`
- `FeatureGrid`

## Folder Structure

Recommended:

```txt
app/
  (marketing)/
  (app)/
components/
  layout/
  marketing/
  cards/
  ui/
lib/
  utils.ts
types/
```

## Acceptance Criteria

- App runs locally.
- All placeholder routes load.
- Navigation works.
- Responsive layout works.
- No auth required yet.
- No database required yet.
- No broken imports.
- `npm run lint` passes.
- `npm run typecheck` passes.
- `npm run build` passes.

## Claude Instruction

Implement Phase 1 only. Do not add Supabase yet unless the project scaffold requires environment placeholders. Do not build the card editor yet.
