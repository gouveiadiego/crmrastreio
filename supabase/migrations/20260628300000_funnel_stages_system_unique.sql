-- Garante no máximo 1 etapa is_system por org
create unique index if not exists funnel_stages_org_system_unique
  on public.funnel_stages (organization_id)
  where (is_system = true);
