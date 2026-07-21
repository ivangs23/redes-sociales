alter default privileges in schema public revoke execute on functions from public, anon;

alter table public.orgs add column timezone text not null default 'UTC';
