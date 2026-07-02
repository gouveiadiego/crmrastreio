-- supabase/migrations/20260701000000_lead_stage_history.sql

create table public.lead_stage_history (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id         uuid not null references public.leads(id) on delete cascade,
  from_stage_id   uuid references public.funnel_stages(id) on delete set null,
  to_stage_id     uuid not null references public.funnel_stages(id) on delete cascade,
  changed_at      timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

create index lead_stage_history_organization_id_idx on public.lead_stage_history(organization_id);
create index lead_stage_history_lead_id_idx on public.lead_stage_history(lead_id);
create index lead_stage_history_org_changed_at_idx
  on public.lead_stage_history(organization_id, changed_at);

alter table public.lead_stage_history enable row level security;

create policy "members read lead_stage_history"
  on public.lead_stage_history for select
  using (public.is_org_member(organization_id));

create policy "members insert lead_stage_history"
  on public.lead_stage_history for insert
  with check (public.is_org_member(organization_id));
