create extension if not exists pgcrypto;

create type public.member_role as enum ('owner', 'member');

create table public.orgs (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(trim(name)) > 0),
  plan       text not null default 'free',
  created_at timestamptz not null default now()
);

create table public.memberships (
  org_id     uuid not null references public.orgs (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       public.member_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create index memberships_user_id_idx on public.memberships (user_id);

alter table public.orgs enable row level security;
alter table public.memberships enable row level security;

-- SECURITY DEFINER para que la política de orgs pueda leer memberships
-- sin quedar atrapada por la propia RLS de memberships (recursión).
create function public.is_org_member(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.org_id = target
      and m.user_id = auth.uid()
  );
$$;

create policy orgs_select_members
  on public.orgs for select to authenticated
  using (public.is_org_member(id));

create policy memberships_select_own
  on public.memberships for select to authenticated
  using (user_id = auth.uid());

-- Sin políticas de INSERT, UPDATE ni DELETE: toda escritura pasa por
-- funciones SECURITY DEFINER. Es intencionado, no un olvido.
