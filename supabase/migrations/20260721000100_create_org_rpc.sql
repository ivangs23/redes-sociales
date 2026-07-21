create function public.create_org_for_current_user(org_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller  uuid := auth.uid();
  new_org uuid;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;

  insert into public.orgs (name)
  values (trim(org_name))
  returning id into new_org;

  insert into public.memberships (org_id, user_id, role)
  values (new_org, caller, 'owner');

  return new_org;
end;
$$;

revoke all on function public.create_org_for_current_user(text) from public;
grant execute on function public.create_org_for_current_user(text) to authenticated;
