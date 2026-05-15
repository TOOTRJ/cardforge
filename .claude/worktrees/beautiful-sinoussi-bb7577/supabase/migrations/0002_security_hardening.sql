-- Phase 2 hardening — addresses Supabase security advisor warnings:
--   * function_search_path_mutable for set_profiles_updated_at
--   * security_definer functions executable by anon / authenticated for handle_new_user
--
-- Apply via the Supabase CLI (`supabase db push`) or the Supabase MCP.

-- 1. Pin the search_path on the updated_at trigger function so it can't be
--    hijacked by callers setting an unsafe search_path.
create or replace function public.set_profiles_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 2. handle_new_user() runs only as a trigger on auth.users; nobody should be
--    able to call it directly via /rest/v1/rpc/handle_new_user. Revoke EXECUTE
--    from PUBLIC, anon, and authenticated. The trigger keeps working because
--    SECURITY DEFINER + AFTER INSERT trigger fires regardless of the calling
--    role's grants on the function.
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.handle_new_user() from anon;
revoke execute on function public.handle_new_user() from authenticated;
