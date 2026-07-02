# Dashboard de Rastreio de Leads — Design Spec
**Data:** 2026-07-01
**Status:** Aprovado

## Problema

O dashboard (`/app/[orgSlug]/dashboard`) hoje é 100% dado de mentirinha — `kpisMock` e `chartMock` em `lib/mock/dashboard.ts`, com um `DemoBanner` avisando isso na tela. Enquanto isso, o CRM já roda de verdade um Kanban de leads (`leads` + `funnel_stages`) com disparo automático de eventos pro Meta CAPI, e um rastreamento de origem via WhatsApp (`conversations.tracking`, `capi_contact_fired`). Nenhum desses dados aparece no dashboard.

**Objetivo desta fase:** substituir os mocks por números reais — leads novos, funil de conversão por etapa, vendas fechadas e saúde do rastreamento CAPI — usando o que já existe no banco, mais uma tabela nova de histórico de etapas (necessária pra calcular taxa de conversão por período).

---

## Escopo desta implementação (fase 1)

### Dentro do escopo
- KPIs reais: leads novos no período (com comparação % vs período anterior), vendas fechadas + valor total, saúde do CAPI (sucesso vs erro)
- Gráfico de evolução de leads novos ao longo do tempo
- Gráfico de funil de conversão por etapa (com histórico real de transições)
- Seletor de período (7 / 30 / 90 dias)
- Nova tabela `lead_stage_history` pra registrar toda mudança de etapa de um lead

### Fora do escopo (fase 2 — quebra por campanha/anúncio)
- Resolver `ad_id` em nome de campanha/anúncio (exige integração com a Meta Marketing API)
- Quebra de leads por origem/campanha/criativo
- Custo por lead / ROAS (exige dado de investimento em anúncio, que não é rastreado hoje)

---

## Banco de dados

### Migration: nova tabela `lead_stage_history`

```sql
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
```

**Sem policy de update/delete** — é um log de auditoria imutável. `from_stage_id` fica `null` na primeira entrada de um lead no funil (criação).

Não é destrutiva (só adiciona tabela nova), mas ainda é mudança de banco — revisar a migration antes de aplicar em produção.

---

## Gravação do histórico (código, não trigger)

Seguindo o padrão do projeto (Server Actions fazem o trabalho, não gatilhos no banco — mais fácil de testar e dar manutenção), o histórico é gravado dentro das actions que já existem em `lib/leads/actions.ts`:

### `createLeadAction`
Depois de inserir o lead, insere uma linha em `lead_stage_history` com `from_stage_id: null` e `to_stage_id: funnel_stage_id` (entrada inicial no funil).

### `moveLeadAction`
Já busca o lead atual antes de mover (`select ... from leads`) — passa a incluir `funnel_stage_id` nessa busca pra saber a etapa de origem. Depois que o `update` do lead é bem-sucedido, insere uma linha em `lead_stage_history` com `from_stage_id: <etapa antiga>` e `to_stage_id: newStageId`.

```typescript
// dentro de moveLeadAction, após o update do lead ter sucesso
await supabase.from("lead_stage_history").insert({
  organization_id: org.id,
  lead_id: parsed.data.leadId,
  from_stage_id: lead.funnel_stage_id, // etapa antes do update
  to_stage_id: parsed.data.newStageId,
});
```

Se a gravação do histórico falhar, loga o erro mas **não desfaz a mudança de etapa** — mover o lead é a ação principal, o histórico é um efeito colateral de analytics.

---

## Queries novas — `lib/dashboard/queries.ts`

| Função | O que calcula |
|---|---|
| `getLeadsCountSeries(orgId, from, to)` | Leads novos por dia (`leads.created_at`) dentro do período — alimenta o gráfico de evolução |
| `getLeadsCountComparison(orgId, from, to)` | Total de leads no período atual vs. no período anterior de mesmo tamanho — vira o "+N%" no card |
| `getFunnelConversion(orgId, from, to)` | Para cada `funnel_stage` (ordenado por `position`), conta quantos `lead_stage_history.to_stage_id` bateram naquela etapa dentro do período, e a % em relação à etapa anterior |
| `getSalesSummary(orgId, from, to)` | Soma `leads.sale_value` de leads cuja `lead_stage_history` registrou entrada numa etapa com `meta_event = 'Purchase'` dentro do período |
| `getCapiHealth(orgId, from, to)` | Conta leads com `meta_error` preenchido vs. leads com evento disparado sem erro, entre os que tiveram alguma transição de etapa no período |

**Limitações conhecidas (documentadas, não bloqueiam):**
- `leads.sale_value` guarda o valor mais recente informado na tela, não um valor histórico por transição. Na prática isso não é problema porque a etapa de venda (`Purchase`) costuma ser terminal — mas se um lead for movido de volta pra uma etapa anterior depois de vendido, o valor antigo se perde. Fase 1 aceita essa limitação; resolver isso (guardar `value` na própria linha do histórico) fica pra uma iteração futura se virar problema real.
- `leads.meta_error` reflete só a **tentativa mais recente** de disparo CAPI daquele lead, não um resultado por transição. Se um lead teve duas transições com evento Meta dentro do período escolhido, `getCapiHealth` só enxerga o resultado da última. Aceitável pra fase 1 (a maioria dos leads faz uma transição relevante por período), mas fica registrado como simplificação.

---

## Telas e componentes

- **`app/(app)/app/[orgSlug]/dashboard/page.tsx`** (Server Component) — lê `searchParams.period` (`7` | `30` | `90`, padrão `30`), calcula `from`/`to`, chama as queries acima, passa os dados pros componentes. Remove `DemoBanner`, `kpisMock`, `chartMock` e o texto de "próximo passo".
- **`period-selector.tsx`** (novo, Client Component) — botões "7 dias / 30 dias / 90 dias" que atualizam `?period=` na URL (sem recarregar a página inteira, via `useRouter`).
- **`kpi-card.tsx`** — mantém o visual atual (valor + delta + sparkline), mas passa a receber números calculados de verdade em vez de `Kpi` do mock.
- **`leads-over-time-chart.tsx`** — adapta o `dashboard-chart.tsx` existente (mesmo `AreaChart` via Recharts/shadcn) pra plotar `getLeadsCountSeries`.
- **`funnel-conversion-chart.tsx`** (novo) — gráfico de barras horizontais: uma barra por etapa do funil, com contagem absoluta e % de conversão em relação à etapa anterior.
- **`capi-health-card.tsx`** (novo) — card simples: "X eventos enviados com sucesso, Y com erro" no período.
- **Estados vazios:**
  - Organização sem `funnel_stages` configuradas → mensagem + link pra `/settings/funil`
  - Sem nenhum lead no período escolhido → mensagem "Nenhum lead nesse período" em vez de gráfico vazio quebrado

---

## Testes

- `lib/dashboard/queries.test.ts` — cada função de agregação testada com dados semeados (segue o padrão de testes já usado no projeto pra `lib/leads/`)
- `lib/leads/actions.test.ts` — novos casos garantindo que `createLeadAction` e `moveLeadAction` gravam a linha correta em `lead_stage_history` (incluindo `from_stage_id: null` na criação)
- Validação manual: abrir `/app/[orgSlug]/dashboard` localmente com dados reais e comparar visualmente com o que está no Kanban de leads antes de considerar pronto

---

## Checklist de validação

- [ ] Dashboard não importa mais nada de `lib/mock/dashboard.ts`
- [ ] Card "leads novos" bate com a contagem real de `leads` criados no período
- [ ] Gráfico de funil mostra as etapas na ordem certa (`position`) com % de conversão coerente
- [ ] Mover um lead no Kanban gera uma linha nova em `lead_stage_history`
- [ ] Criar um lead gera a entrada inicial no histórico (`from_stage_id: null`)
- [ ] Card de vendas bate com a soma de `sale_value` dos leads na etapa de `Purchase`
- [ ] Card de saúde do CAPI reflete `meta_error` corretamente
- [ ] Trocar o seletor de período (7/30/90) atualiza todos os widgets
- [ ] Organização sem etapas configuradas vê uma mensagem de setup, não um erro
- [ ] `npx tsc --noEmit` e `npm run build` passam sem erro

---

## Arquivos criados/modificados

| Arquivo | Tipo | O que muda |
|---|---|---|
| `supabase/migrations/20260701000000_lead_stage_history.sql` | Novo | Tabela `lead_stage_history` + RLS |
| `lib/leads/actions.ts` | Modificado | `createLeadAction` e `moveLeadAction` gravam histórico de etapa |
| `lib/dashboard/queries.ts` | Novo | `getLeadsCountSeries`, `getLeadsCountComparison`, `getFunnelConversion`, `getSalesSummary`, `getCapiHealth` |
| `app/(app)/app/[orgSlug]/dashboard/page.tsx` | Modificado | Remove mocks, busca dados reais, lê `searchParams.period` |
| `app/(app)/app/[orgSlug]/dashboard/period-selector.tsx` | Novo | Seletor de período (Client Component) |
| `app/(app)/app/[orgSlug]/dashboard/kpi-card.tsx` | Modificado | Aceita dados reais em vez do tipo `Kpi` do mock |
| `app/(app)/app/[orgSlug]/dashboard/leads-over-time-chart.tsx` | Renomeado/Modificado | Antigo `dashboard-chart.tsx`, agora com dados reais |
| `app/(app)/app/[orgSlug]/dashboard/funnel-conversion-chart.tsx` | Novo | Gráfico de barras do funil de conversão |
| `app/(app)/app/[orgSlug]/dashboard/capi-health-card.tsx` | Novo | Card de saúde do rastreamento CAPI |
| `lib/dashboard/queries.test.ts` | Novo | Testes das funções de agregação |
| `lib/leads/actions.test.ts` | Modificado | Testes de gravação do histórico de etapa |
