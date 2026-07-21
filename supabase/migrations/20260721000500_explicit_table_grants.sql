-- On a database created by Supabase CLI/CI from a clean state, the
-- `authenticated` role holds no table privileges at all on public.orgs and
-- public.memberships: RLS policies exist, but with zero privileges the
-- grant check fails first ("permission denied for table ...", SQLSTATE
-- 42501) and the policy is never even consulted. Locally, these tables
-- still carry the broad legacy grants (`arwdDxtm`) that Postgres assigns to
-- the table owner's co-roles by default in older bootstraps, which is why
-- this divergence never surfaced until CI ran against a fresh database.
--
-- Make the intended privileges explicit instead of relying on whatever a
-- given database happened to inherit. Revoke everything first so local and
-- CI both start from the same known-empty state, then grant back only
-- what the application actually needs.

revoke all privileges on public.orgs, public.memberships from anon, authenticated;

-- Reads go through RLS (orgs_select_members / memberships_select_own).
-- Writes go exclusively through the SECURITY DEFINER functions
-- (create_org_for_current_user, ensure_org_for_current_user), which run as
-- their owner and are therefore unaffected by this table-level grant. No
-- insert/update/delete grant is added here on purpose.
grant select on public.orgs, public.memberships to authenticated;

-- Phase 1a will add more tables to this schema. Without this, a fresh
-- table would default to broad legacy-style grants again on some
-- databases and none on others, silently reintroducing the exact
-- divergence this migration fixes. Pin the default for future tables so
-- every new table starts with zero privileges for anon/authenticated and
-- must have its grants added explicitly, the same way orgs and
-- memberships now do.
alter default privileges in schema public
  revoke all on tables from anon, authenticated;
