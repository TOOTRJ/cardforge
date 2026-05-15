# Phase 2 — Supabase Database & Auth

## Goal

Add Supabase authentication, profile creation, protected routes, and initial database schema.

## Scope

Build:

- Supabase client setup
- Supabase server client setup
- login page
- signup page
- logout action
- protected dashboard routes
- profile table
- automatic profile creation after signup
- basic settings/profile update flow

## Pages

Create/update:

- `/login`
- `/signup`
- `/dashboard`
- `/settings`

## Database Tables

Create migrations for:

### profiles

Fields:

- id uuid primary key references auth.users(id)
- username text unique
- display_name text
- avatar_url text
- bio text
- website_url text
- created_at timestamptz
- updated_at timestamptz

## RLS

Profiles:

- Public profiles readable by everyone.
- Users can insert/update only their own profile.

## Auth UX

After login/signup, redirect to `/dashboard`.

If username is missing, settings page should encourage completing profile.

## Environment Variables

Use:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` only if absolutely necessary and never exposed client-side

## Acceptance Criteria

- User can sign up.
- User can log in.
- User can log out.
- User can access dashboard only when authenticated.
- Profile row exists after signup or first login.
- User can update display name and username.
- RLS policies are included.
- Build passes.

## Claude Instruction

Implement Phase 2 only. Do not build card tables yet except if needed for type placeholders. Do not build card creator logic yet.
