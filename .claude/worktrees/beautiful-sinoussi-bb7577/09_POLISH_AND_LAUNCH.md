# Phase 9 — MVP Polish & Launch Readiness

## Goal

Prepare the MVP for public launch.

## Scope

Polish:

- UX
- empty states
- error states
- loading states
- mobile responsiveness
- SEO
- metadata
- Open Graph images
- legal disclaimer
- privacy/terms placeholders
- performance
- accessibility

## Required Pages

Add/update:

- `/terms`
- `/privacy`
- `/disclaimer`
- `/about`

## SEO Requirements

Public pages should have metadata:

- title
- description
- OG image where possible
- canonical URL if configured

## Accessibility Requirements

- usable keyboard navigation
- labels for inputs
- good color contrast
- visible focus states
- alt text for uploaded/public images when available

## Performance Requirements

- optimized images
- no unnecessary client components
- no huge bundles from unused libraries
- gallery pagination or infinite loading
- efficient Supabase queries

## Launch Checklist

- Auth works
- RLS works
- Card creation works
- Uploads work
- Export works
- Public gallery works
- Private cards are protected
- Profile pages work
- Sets work
- AI helper works if enabled
- Legal disclaimer visible
- Build passes

## Acceptance Criteria

- App feels cohesive and polished.
- No obvious placeholder UI remains in MVP paths.
- Mobile flow is usable.
- Public pages are crawlable.
- Build passes.
- Ready for deployment.

## Claude Instruction

Implement Phase 9 only. Focus on launch polish, not new product expansion.
