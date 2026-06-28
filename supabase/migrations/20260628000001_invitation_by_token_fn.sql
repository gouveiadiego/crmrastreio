-- Função pública para buscar convite pelo token sem exigir autenticação.
-- Segurança vem do token (256 bits de entropia) — só quem tem o link consegue acessar.
-- SECURITY DEFINER + row_security = off pra contornar RLS de invitations e organizations.
create or replace function public.get_invitation_by_token(_token text)
returns table (
  email text,
  role public.org_role,
  expires_at timestamptz,
  accepted_at timestamptz,
  organization_id uuid,
  org_name text,
  org_slug text
)
language sql
security definer
stable
set search_path = public
set row_security = off
as $$
  select
    i.email,
    i.role,
    i.expires_at,
    i.accepted_at,
    i.organization_id,
    o.name  as org_name,
    o.slug  as org_slug
  from public.invitations i
  join public.organizations o on o.id = i.organization_id
  where i.token = _token
  limit 1;
$$;

revoke execute on function public.get_invitation_by_token(text) from public;
grant execute on function public.get_invitation_by_token(text) to anon, authenticated;
