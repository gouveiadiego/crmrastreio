-- Adiciona campo is_system à tabela funnel_stages
alter table public.funnel_stages
  add column if not exists is_system boolean not null default false;
