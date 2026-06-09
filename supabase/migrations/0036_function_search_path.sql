-- 0036_function_search_path.sql — harden the two remaining analytics helpers
-- (defined in 0017) by pinning a stable search_path, matching every other
-- function in the schema and clearing the Supabase security advisor warning.
-- Body unchanged; this only sets the function config.

alter function public.card_ai_calls_daily(since timestamp with time zone)
  set search_path = public;

alter function public.scryfall_calls_daily(since timestamp with time zone)
  set search_path = public;
