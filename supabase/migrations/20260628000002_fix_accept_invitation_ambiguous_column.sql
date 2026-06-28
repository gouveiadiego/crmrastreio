-- Fix: ON CONFLICT (organization_id, user_id) era ambíguo porque a função
-- também retorna uma coluna chamada organization_id (RETURNS TABLE).
-- Usando ON CONFLICT ON CONSTRAINT elimina a ambiguidade.
create or replace function public.accept_invitation(_token text)
returns table(organization_id uuid, slug text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.invitations%rowtype;
  v_user_email text;
begin
  v_user_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  if v_user_email = '' then
    raise exception 'not authenticated';
  end if;

  -- Lock + read
  select * into v_invite
  from public.invitations
  where token = _token
  for update;

  if v_invite is null then
    raise exception 'invitation not found';
  end if;
  if v_invite.accepted_at is not null then
    raise exception 'invitation already accepted';
  end if;
  if v_invite.expires_at < now() then
    raise exception 'invitation expired';
  end if;
  if lower(v_invite.email) <> v_user_email then
    raise exception 'invitation is for different email';
  end if;

  -- Marca invite como aceito
  update public.invitations
  set accepted_at = now()
  where id = v_invite.id;

  -- Insere membership (idempotente — se já existe não faz nada)
  insert into public.memberships (organization_id, user_id, role)
  values (v_invite.organization_id, auth.uid(), v_invite.role)
  on conflict on constraint memberships_organization_id_user_id_key do nothing;

  -- Retorna info pra UI redirecionar
  return query
    select o.id, o.slug
    from public.organizations o
    where o.id = v_invite.organization_id;
end;
$$;
