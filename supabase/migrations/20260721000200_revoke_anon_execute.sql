-- Supabase's project-wide default privileges grant EXECUTE on every new
-- function in the public schema to anon, authenticated and service_role.
-- The previous migrations only ran `revoke all ... from public`, which
-- strips the blanket PUBLIC grant but leaves the anon-specific grant from
-- that default ACL untouched. These functions are SECURITY DEFINER and are
-- the only sanctioned write path (the tables carry no write policies for
-- authenticated), so the grant itself must be the outer defence, not just
-- the internal auth.uid() check. Revoke anon's EXECUTE explicitly here;
-- authenticated keeps its existing grant.

revoke execute on function public.create_org_for_current_user(text) from anon;

-- is_org_member's defining migration never ran `revoke all ... from public`
-- (unlike create_org_for_current_user), so it still carries a PUBLIC grant
-- in its ACL. A revoke targeted only at anon is a no-op here: Postgres
-- resolves privileges as the union of a role's own grants and the PUBLIC
-- grant, so anon keeps EXECUTE via PUBLIC regardless of an anon-specific
-- revoke. Strip the PUBLIC grant, then restore it for the roles that
-- legitimately need it (authenticated for RLS policy evaluation,
-- service_role for admin access).
revoke execute on function public.is_org_member(uuid) from anon;
revoke all on function public.is_org_member(uuid) from public;
grant execute on function public.is_org_member(uuid) to authenticated, service_role;
