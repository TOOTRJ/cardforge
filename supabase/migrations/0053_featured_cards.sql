-- 0053_featured_cards.sql — admin-curated homepage hero cards.
--
-- Two fixed slots; the admin pastes a card URL per slot in /admin/featured.
-- World-readable (the homepage is static/ISR and reads via the public
-- client); ALL writes go through the service-role client gated on
-- profiles.is_admin in app code — no user-facing write policies exist, so
-- owners can't feature their own cards.

create table if not exists public.featured_cards (
  slot int primary key,
  card_id uuid not null references public.cards (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint featured_cards_slot_check check (slot in (1, 2))
);

alter table public.featured_cards enable row level security;

drop policy if exists "Featured cards are publicly readable" on public.featured_cards;
create policy "Featured cards are publicly readable"
  on public.featured_cards for select
  using (true);
-- No INSERT/UPDATE/DELETE policies: service-role writes only.
