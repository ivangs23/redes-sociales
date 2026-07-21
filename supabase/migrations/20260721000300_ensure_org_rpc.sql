create function public.ensure_org_for_current_user(org_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller   uuid := auth.uid();
  existing uuid;
  new_org  uuid;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;

  -- Serialises concurrent logins by the same user for the rest of this
  -- transaction, so a double-submitted form cannot create two orgs.
  perform pg_advisory_xact_lock(hashtextextended(caller::text, 0));

  select m.org_id into existing
  from public.memberships m
  where m.user_id = caller
  order by m.created_at
  limit 1;

  if existing is not null then
    return existing;
  end if;

  insert into public.orgs (name)
  values (trim(org_name))
  returning id into new_org;

  insert into public.memberships (org_id, user_id, role)
  values (new_org, caller, 'owner');

  return new_org;
end;
$$;

revoke all on function public.ensure_org_for_current_user(text) from public, anon;
grant execute on function public.ensure_org_for_current_user(text) to authenticated;
