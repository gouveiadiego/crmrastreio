-- ============================================================
-- Funil de Leads WhatsApp + Meta CAPI
-- ============================================================

-- 1. Etapas personalizáveis do kanban
create table public.funnel_stages (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  meta_event      text,
  -- Valores válidos: 'Lead', 'CompleteRegistration', 'Schedule',
  -- 'InitiateCheckout', 'Purchase', 'LeadLost', null
  color           text not null default '#6b7280',
  position        integer not null default 0,
  requires_value  boolean not null default false,
  created_at      timestamptz not null default now()
);

create index funnel_stages_organization_id_idx on public.funnel_stages(organization_id);
create index funnel_stages_org_position_idx on public.funnel_stages(organization_id, position);

alter table public.funnel_stages enable row level security;

create policy "members read funnel_stages"
  on public.funnel_stages for select
  using (public.is_org_member(organization_id));

create policy "admins insert funnel_stages"
  on public.funnel_stages for insert
  with check (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

create policy "admins update funnel_stages"
  on public.funnel_stages for update
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

create policy "admins delete funnel_stages"
  on public.funnel_stages for delete
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

-- 2. Cards de leads do kanban
create table public.leads (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  funnel_stage_id  uuid not null references public.funnel_stages(id),
  conversation_id  uuid references public.conversations(id) on delete set null,
  contact_id       uuid references public.contacts(id) on delete set null,
  name             text,
  phone            text,
  sale_value       numeric(10,2),
  last_meta_event  text,
  meta_error       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint leads_conversation_id_unique unique (conversation_id)
);

create index leads_organization_id_idx on public.leads(organization_id);
create index leads_funnel_stage_id_idx on public.leads(funnel_stage_id);

alter table public.leads enable row level security;

create policy "members read leads"
  on public.leads for select
  using (public.is_org_member(organization_id));

create policy "members insert leads"
  on public.leads for insert
  with check (public.is_org_member(organization_id));

create policy "members update leads"
  on public.leads for update
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

create policy "admins delete leads"
  on public.leads for delete
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

-- 3. Credenciais Meta por org
create table public.meta_integrations (
  organization_id  uuid primary key references public.organizations(id) on delete cascade,
  pixel_id         text not null,
  capi_token       text not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.meta_integrations enable row level security;

create policy "admins read meta_integrations"
  on public.meta_integrations for select
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

create policy "admins insert meta_integrations"
  on public.meta_integrations for insert
  with check (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

create policy "admins update meta_integrations"
  on public.meta_integrations for update
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

create policy "admins delete meta_integrations"
  on public.meta_integrations for delete
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

create trigger meta_integrations_set_updated_at
  before update on public.meta_integrations
  for each row execute function public.set_updated_at();
