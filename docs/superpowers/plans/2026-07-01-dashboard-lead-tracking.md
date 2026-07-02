# Dashboard de Rastreio de Leads — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o dashboard de dados de mentirinha por números reais de leads — leads novos, funil de conversão por etapa, vendas fechadas e saúde do rastreamento CAPI — com seletor de período (7/30/90 dias).

**Architecture:** Uma tabela nova (`lead_stage_history`) registra toda mudança de etapa de um lead, gravada dentro das próprias Server Actions que já movem leads no Kanban (sem gatilho no banco). Funções puras de agregação (`lib/dashboard/aggregations.ts`) fazem as contas a partir de linhas cruas vindas do Supabase, chamadas por funções finas de I/O (`lib/dashboard/queries.ts`). O `page.tsx` do dashboard lê o período da URL, busca os dados em paralelo e passa pros componentes de tela.

**Tech Stack:** Next.js 16 App Router (Server Components + Server Actions), Supabase (PostgreSQL + RLS), Recharts via shadcn `ChartContainer`, Vitest, TypeScript strict.

## Global Constraints

- TypeScript strict — zero `any`, zero `@ts-ignore`
- Toda tabela nova tem `organization_id` + RLS habilitada (`ENABLE`, nunca `FORCE ROW LEVEL SECURITY`)
- Server Actions retornam `{ ok: true; data?: T } | { ok: false; error: string }`
- Toda UI visível em PT-BR coloquial
- Após a migration: rodar `npm run types` para regenerar `types/supabase.ts`
- Após cada task: `npx tsc --noEmit` deve retornar zero erros
- Ao final: `npm run build` e `npm run test` passando

---

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `supabase/migrations/20260701000000_lead_stage_history.sql` | Criar | Tabela `lead_stage_history` + RLS |
| `lib/leads/actions.ts` | Modificar | `createLeadAction`/`moveLeadAction` gravam histórico de etapa |
| `tests/leads-actions-history.test.ts` | Criar | Testes da gravação de histórico |
| `lib/dashboard/aggregations.ts` | Criar | Funções puras de agregação (sem I/O) |
| `tests/dashboard-aggregations.test.ts` | Criar | Testes das funções de agregação |
| `lib/dashboard/queries.ts` | Criar | Funções de I/O que buscam do Supabase e chamam as agregações |
| `app/(app)/app/[orgSlug]/dashboard/period-selector.tsx` | Criar | Seletor de período (Client Component) |
| `app/(app)/app/[orgSlug]/dashboard/kpi-card.tsx` | Modificar | Recebe dados reais (label/value/percentChange) em vez do mock |
| `app/(app)/app/[orgSlug]/dashboard/leads-over-time-chart.tsx` | Criar | Substitui `dashboard-chart.tsx` — gráfico de evolução real |
| `app/(app)/app/[orgSlug]/dashboard/dashboard-chart.tsx` | Remover | Substituído por `leads-over-time-chart.tsx` |
| `app/(app)/app/[orgSlug]/dashboard/funnel-conversion-chart.tsx` | Criar | Gráfico de barras do funil de conversão |
| `app/(app)/app/[orgSlug]/dashboard/capi-health-card.tsx` | Criar | Card de saúde do rastreamento CAPI |
| `app/(app)/app/[orgSlug]/dashboard/page.tsx` | Modificar | Remove mocks, lê período da URL, busca dados reais |
| `lib/mock/dashboard.ts` | Remover | Não é mais usado por nenhuma tela |

---

## Task 1: Migration — tabela `lead_stage_history`

**Files:**
- Create: `supabase/migrations/20260701000000_lead_stage_history.sql`

**Interfaces:**
- Produces: tabela `public.lead_stage_history` (`id, organization_id, lead_id, from_stage_id, to_stage_id, changed_at, created_at`) com RLS; tipos regenerados em `types/supabase.ts`

- [ ] **Step 1: Criar o arquivo de migration**

```sql
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
```

- [ ] **Step 2: Aplicar a migration no Supabase**

Cole o SQL acima no Supabase SQL Editor → Run. Confirme que executa sem erro.

- [ ] **Step 3: Regenerar os tipos TypeScript**

```bash
npm run types
```

Esperado: `types/supabase.ts` atualizado com a tabela `lead_stage_history` (Row com `id`, `organization_id`, `lead_id`, `from_stage_id`, `to_stage_id`, `changed_at`, `created_at`).

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit
```

Esperado: zero erros.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260701000000_lead_stage_history.sql types/supabase.ts
git commit -m "feat: add lead_stage_history table for funnel conversion tracking"
```

---

## Task 2: `lib/leads/actions.ts` — gravar histórico de etapa

**Files:**
- Modify: `lib/leads/actions.ts`
- Test: `tests/leads-actions-history.test.ts`

**Interfaces:**
- Consumes: tabela `lead_stage_history` (Task 1)
- Produces: toda chamada de `createLeadAction` e `moveLeadAction` grava uma linha em `lead_stage_history`

- [ ] **Step 1: Escrever os testes (falharão inicialmente)**

Crie `tests/leads-actions-history.test.ts`:

```typescript
import { describe, expect, test, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/guards", () => ({
  requireOrgMember: vi.fn(),
  requireOrgRole: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => Promise.resolve(fn()) }));

import { createClient } from "@/lib/supabase/server";
import { requireOrgMember } from "@/lib/auth/guards";
import { createLeadAction, moveLeadAction } from "@/lib/leads/actions";

const mockedCreate = createClient as unknown as ReturnType<typeof vi.fn>;
const mockedMember = requireOrgMember as unknown as ReturnType<typeof vi.fn>;

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const LEAD_ID = "22222222-2222-2222-2222-222222222222";
const STAGE_FROM = "33333333-3333-3333-3333-333333333333";
const STAGE_TO = "44444444-4444-4444-4444-444444444444";

function makeSupabase(opts: {
  stage?: { id: string; meta_event: string | null; requires_value: boolean } | null;
  lead?: { id: string; phone: string | null; name: string | null; funnel_stage_id: string } | null;
  insertLeadResult?: { id: string } | null;
}) {
  const historyInserts: Record<string, unknown>[] = [];

  const from = vi.fn((table: string) => {
    if (table === "funnel_stages") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: opts.stage ?? null }),
            }),
          }),
        }),
      };
    }
    if (table === "leads") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: opts.lead ?? null }),
            }),
          }),
        }),
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: opts.insertLeadResult ?? null,
              error: opts.insertLeadResult ? null : new Error("insert fail"),
            }),
          }),
        }),
        update: () => ({
          eq: () => ({
            eq: async () => ({ error: null }),
          }),
        }),
      };
    }
    if (table === "lead_stage_history") {
      return {
        insert: (row: Record<string, unknown>) => {
          historyInserts.push(row);
          return Promise.resolve({ error: null });
        },
      };
    }
    return {};
  });

  return { supabase: { from } as never, historyInserts };
}

describe("createLeadAction — grava histórico de etapa", () => {
  beforeEach(() => {
    mockedCreate.mockReset();
    mockedMember.mockReset();
  });

  test("grava entrada inicial no histórico com from_stage_id null", async () => {
    mockedMember.mockResolvedValue({ org: { id: ORG_ID } });
    const { supabase, historyInserts } = makeSupabase({ insertLeadResult: { id: LEAD_ID } });
    mockedCreate.mockResolvedValue(supabase);

    const result = await createLeadAction({
      orgSlug: "acme",
      funnel_stage_id: STAGE_TO,
      name: "Ana",
      phone: "+5511999990000",
    });

    expect(result.ok).toBe(true);
    expect(historyInserts).toHaveLength(1);
    expect(historyInserts[0]).toMatchObject({
      organization_id: ORG_ID,
      lead_id: LEAD_ID,
      from_stage_id: null,
      to_stage_id: STAGE_TO,
    });
  });
});

describe("moveLeadAction — grava histórico de etapa", () => {
  beforeEach(() => {
    mockedCreate.mockReset();
    mockedMember.mockReset();
  });

  test("grava transição com from_stage_id da etapa anterior", async () => {
    mockedMember.mockResolvedValue({ org: { id: ORG_ID } });
    const { supabase, historyInserts } = makeSupabase({
      stage: { id: STAGE_TO, meta_event: null, requires_value: false },
      lead: { id: LEAD_ID, phone: "+5511999990000", name: "Ana", funnel_stage_id: STAGE_FROM },
    });
    mockedCreate.mockResolvedValue(supabase);

    const result = await moveLeadAction({
      orgSlug: "acme",
      leadId: LEAD_ID,
      newStageId: STAGE_TO,
    });

    expect(result.ok).toBe(true);
    expect(historyInserts).toHaveLength(1);
    expect(historyInserts[0]).toMatchObject({
      organization_id: ORG_ID,
      lead_id: LEAD_ID,
      from_stage_id: STAGE_FROM,
      to_stage_id: STAGE_TO,
    });
  });
});
```

- [ ] **Step 2: Rodar os testes para confirmar que falham**

```bash
npm run test -- tests/leads-actions-history.test.ts
```

Esperado: FAIL — `historyInserts` vazio (o código ainda não grava histórico).

- [ ] **Step 3: Modificar `createLeadAction` em `lib/leads/actions.ts`**

Localize `createLeadAction` (linhas 27–56) e adicione a gravação do histórico logo após o bloco de erro do insert, antes do `revalidatePath`:

```typescript
export async function createLeadAction(
  input: CreateLeadInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = createLeadSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };

  const { org } = await requireOrgMember({ orgSlug: parsed.data.orgSlug });
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("leads")
    .insert({
      organization_id: org.id,
      funnel_stage_id: parsed.data.funnel_stage_id,
      conversation_id: parsed.data.conversationId ?? null,
      name: parsed.data.name ?? null,
      phone: parsed.data.phone ?? null,
    })
    .select("id")
    .single();

  if (error || !data) {
    logError("leads.create", error);
    return { ok: false, error: "Erro ao criar lead. Tente novamente." };
  }

  const { error: historyError } = await supabase.from("lead_stage_history").insert({
    organization_id: org.id,
    lead_id: data.id,
    from_stage_id: null,
    to_stage_id: parsed.data.funnel_stage_id,
  });
  if (historyError) logError("leads.stage-history-create", historyError);

  revalidatePath(`/app/${parsed.data.orgSlug}/leads`);
  return { ok: true, data: { id: data.id } };
}
```

- [ ] **Step 4: Modificar `moveLeadAction` em `lib/leads/actions.ts`**

Troque a função inteira por esta versão (o `select` do lead ganha `funnel_stage_id`, e a gravação do histórico entra depois do `update` bem-sucedido):

```typescript
export async function moveLeadAction(input: MoveLeadInput): Promise<ActionResult> {
  const parsed = moveLeadSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };

  const { org } = await requireOrgMember({ orgSlug: parsed.data.orgSlug });
  const supabase = await createClient();

  // Busca etapa destino pra validar requires_value e pegar o meta_event
  const { data: stage } = await supabase
    .from("funnel_stages")
    .select("id, meta_event, requires_value")
    .eq("id", parsed.data.newStageId)
    .eq("organization_id", org.id)
    .maybeSingle();

  if (!stage) return { ok: false, error: "Etapa não encontrada." };

  if (stage.requires_value && !parsed.data.saleValue) {
    return { ok: false, error: "Informe o valor da venda para essa etapa." };
  }

  // Busca lead pra pegar phone/name pro CAPI e a etapa atual pro histórico
  const { data: lead } = await supabase
    .from("leads")
    .select("id, phone, name, funnel_stage_id")
    .eq("id", parsed.data.leadId)
    .eq("organization_id", org.id)
    .maybeSingle();

  if (!lead) return { ok: false, error: "Lead não encontrado." };

  const { error } = await supabase
    .from("leads")
    .update({
      funnel_stage_id: parsed.data.newStageId,
      sale_value: parsed.data.saleValue ?? null,
      meta_error: null,
    })
    .eq("id", parsed.data.leadId)
    .eq("organization_id", org.id);

  if (error) {
    logError("leads.move", error);
    return { ok: false, error: "Erro ao mover lead. Tente novamente." };
  }

  const { error: historyError } = await supabase.from("lead_stage_history").insert({
    organization_id: org.id,
    lead_id: parsed.data.leadId,
    from_stage_id: lead.funnel_stage_id,
    to_stage_id: parsed.data.newStageId,
  });
  if (historyError) logError("leads.stage-history-move", historyError);

  revalidatePath(`/app/${parsed.data.orgSlug}/leads`);

  // Dispara evento CAPI em background — só para eventos válidos do enum
  const isValidCapiEvent = (v: string | null): v is (typeof CAPI_EVENT_NAMES)[number] =>
    CAPI_EVENT_NAMES.includes(v as (typeof CAPI_EVENT_NAMES)[number]);

  if (stage.meta_event && isValidCapiEvent(stage.meta_event)) {
    const orgId = org.id;
    const leadId = parsed.data.leadId;
    const stageId = parsed.data.newStageId;
    const eventName = stage.meta_event;
    const phone = lead.phone;
    const name = lead.name;
    const value = parsed.data.saleValue;

    after(async () => {
      await sendCapiEvent({ orgId, leadId, stageId, eventName, phone, name, value });
    });
  }

  return { ok: true };
}
```

- [ ] **Step 5: Rodar os testes para confirmar que passam**

```bash
npm run test -- tests/leads-actions-history.test.ts
```

Esperado: PASS — 2 testes passando.

- [ ] **Step 6: Rodar a suite completa de testes pra garantir zero regressão**

```bash
npm run test
```

Esperado: todos os testes passando.

- [ ] **Step 7: Typecheck**

```bash
npx tsc --noEmit
```

Esperado: zero erros.

- [ ] **Step 8: Commit**

```bash
git add lib/leads/actions.ts tests/leads-actions-history.test.ts
git commit -m "feat: record funnel stage transitions in lead_stage_history"
```

---

## Task 3: `lib/dashboard/aggregations.ts` — funções puras de agregação

**Files:**
- Create: `lib/dashboard/aggregations.ts`
- Test: `tests/dashboard-aggregations.test.ts`

**Interfaces:**
- Consumes: nada (funções puras, sem I/O)
- Produces:
  - `DateRange = { from: Date; to: Date }`
  - `LeadsCountPoint = { date: string; count: number }`
  - `FunnelStageInput = { id: string; name: string; position: number }`
  - `FunnelConversionResult = { stageId: string; name: string; count: number; conversionPct: number | null }`
  - `CapiHealthResult = { success: number; error: number }`
  - `bucketCountsByDay(timestamps: string[], range: DateRange): LeadsCountPoint[]`
  - `computePercentChange(current: number, previous: number): number | null`
  - `computeFunnelConversion(stages: FunnelStageInput[], transitionCounts: Record<string, number>): FunnelConversionResult[]`
  - `sumSaleValues(values: (number | null)[]): number`
  - `computeCapiHealth(errors: (string | null)[]): CapiHealthResult`

- [ ] **Step 1: Escrever os testes (falharão inicialmente)**

Crie `tests/dashboard-aggregations.test.ts`:

```typescript
import { describe, expect, test } from "vitest";
import {
  bucketCountsByDay,
  computeCapiHealth,
  computeFunnelConversion,
  computePercentChange,
  sumSaleValues,
} from "@/lib/dashboard/aggregations";

describe("bucketCountsByDay", () => {
  test("conta timestamps por dia dentro do intervalo", () => {
    const result = bucketCountsByDay(
      ["2026-06-01T10:00:00Z", "2026-06-01T15:00:00Z", "2026-06-02T08:00:00Z"],
      { from: new Date("2026-06-01T00:00:00Z"), to: new Date("2026-06-03T00:00:00Z") },
    );
    expect(result).toEqual([
      { date: "2026-06-01", count: 2 },
      { date: "2026-06-02", count: 1 },
      { date: "2026-06-03", count: 0 },
    ]);
  });

  test("retorna zero em dias sem nenhum timestamp", () => {
    const result = bucketCountsByDay([], {
      from: new Date("2026-06-01T00:00:00Z"),
      to: new Date("2026-06-02T00:00:00Z"),
    });
    expect(result).toEqual([
      { date: "2026-06-01", count: 0 },
      { date: "2026-06-02", count: 0 },
    ]);
  });
});

describe("computePercentChange", () => {
  test("calcula variação percentual normal", () => {
    expect(computePercentChange(120, 100)).toBe(20);
    expect(computePercentChange(80, 100)).toBe(-20);
  });

  test("retorna 100% quando período anterior era zero e agora tem valor", () => {
    expect(computePercentChange(10, 0)).toBe(100);
  });

  test("retorna null quando os dois períodos são zero", () => {
    expect(computePercentChange(0, 0)).toBeNull();
  });
});

describe("computeFunnelConversion", () => {
  test("primeira etapa não tem conversionPct (null)", () => {
    const result = computeFunnelConversion(
      [
        { id: "s1", name: "Novo", position: 0 },
        { id: "s2", name: "Qualificado", position: 1 },
      ],
      { s1: 100, s2: 40 },
    );
    expect(result[0]).toMatchObject({ stageId: "s1", count: 100, conversionPct: null });
    expect(result[1]).toMatchObject({ stageId: "s2", count: 40, conversionPct: 40 });
  });

  test("ordena etapas por position independente da ordem de entrada", () => {
    const result = computeFunnelConversion(
      [
        { id: "s2", name: "Qualificado", position: 1 },
        { id: "s1", name: "Novo", position: 0 },
      ],
      { s1: 50, s2: 25 },
    );
    expect(result.map((r) => r.stageId)).toEqual(["s1", "s2"]);
  });

  test("etapa sem nenhuma transição no período conta como zero", () => {
    const result = computeFunnelConversion(
      [
        { id: "s1", name: "Novo", position: 0 },
        { id: "s2", name: "Qualificado", position: 1 },
      ],
      {},
    );
    expect(result[1]).toMatchObject({ count: 0, conversionPct: null });
  });
});

describe("sumSaleValues", () => {
  test("soma valores ignorando nulos", () => {
    expect(sumSaleValues([100, null, 50.5, null])).toBe(150.5);
  });

  test("retorna zero para lista vazia", () => {
    expect(sumSaleValues([])).toBe(0);
  });
});

describe("computeCapiHealth", () => {
  test("separa sucesso e erro", () => {
    expect(computeCapiHealth([null, "HTTP 400", null, null])).toEqual({ success: 3, error: 1 });
  });

  test("retorna zero/zero para lista vazia", () => {
    expect(computeCapiHealth([])).toEqual({ success: 0, error: 0 });
  });
});
```

- [ ] **Step 2: Rodar os testes para confirmar que falham**

```bash
npm run test -- tests/dashboard-aggregations.test.ts
```

Esperado: FAIL — módulo `@/lib/dashboard/aggregations` não encontrado.

- [ ] **Step 3: Criar `lib/dashboard/aggregations.ts`**

```typescript
export type DateRange = { from: Date; to: Date };
export type LeadsCountPoint = { date: string; count: number };
export type FunnelStageInput = { id: string; name: string; position: number };
export type FunnelConversionResult = {
  stageId: string;
  name: string;
  count: number;
  conversionPct: number | null;
};
export type CapiHealthResult = { success: number; error: number };

export function bucketCountsByDay(timestamps: string[], range: DateRange): LeadsCountPoint[] {
  const counts = new Map<string, number>();
  for (const ts of timestamps) {
    const day = ts.slice(0, 10);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }

  const days: LeadsCountPoint[] = [];
  const cursor = new Date(range.from);
  cursor.setUTCHours(0, 0, 0, 0);
  const end = new Date(range.to);
  end.setUTCHours(0, 0, 0, 0);

  while (cursor.getTime() <= end.getTime()) {
    const day = cursor.toISOString().slice(0, 10);
    days.push({ date: day, count: counts.get(day) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return days;
}

export function computePercentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? null : 100;
  return Math.round(((current - previous) / previous) * 100);
}

export function computeFunnelConversion(
  stages: FunnelStageInput[],
  transitionCounts: Record<string, number>,
): FunnelConversionResult[] {
  const ordered = [...stages].sort((a, b) => a.position - b.position);
  return ordered.map((stage, index) => {
    const count = transitionCounts[stage.id] ?? 0;
    if (index === 0) {
      return { stageId: stage.id, name: stage.name, count, conversionPct: null };
    }
    const previousCount = transitionCounts[ordered[index - 1].id] ?? 0;
    const conversionPct = previousCount === 0 ? null : Math.round((count / previousCount) * 100);
    return { stageId: stage.id, name: stage.name, count, conversionPct };
  });
}

export function sumSaleValues(values: (number | null)[]): number {
  return values.reduce((sum: number, v) => sum + (v ?? 0), 0);
}

export function computeCapiHealth(errors: (string | null)[]): CapiHealthResult {
  return errors.reduce(
    (acc, e) => (e ? { success: acc.success, error: acc.error + 1 } : { success: acc.success + 1, error: acc.error }),
    { success: 0, error: 0 },
  );
}
```

- [ ] **Step 4: Rodar os testes para confirmar que passam**

```bash
npm run test -- tests/dashboard-aggregations.test.ts
```

Esperado: PASS — 11 testes passando.

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit
```

Esperado: zero erros.

- [ ] **Step 6: Commit**

```bash
git add lib/dashboard/aggregations.ts tests/dashboard-aggregations.test.ts
git commit -m "feat: add pure aggregation functions for the leads dashboard"
```

---

## Task 4: `lib/dashboard/queries.ts` — busca dos dados no Supabase

**Files:**
- Create: `lib/dashboard/queries.ts`

**Interfaces:**
- Consumes: `bucketCountsByDay`, `computePercentChange`, `computeFunnelConversion`, `sumSaleValues`, `computeCapiHealth`, e os tipos `DateRange`/`LeadsCountPoint`/`FunnelConversionResult`/`CapiHealthResult` de `./aggregations` (Task 3); tabela `lead_stage_history` (Task 1)
- Produces:
  - `getLeadsCountSeries(orgId: string, range: DateRange): Promise<LeadsCountPoint[]>`
  - `getLeadsCountComparison(orgId: string, range: DateRange): Promise<{ current: number; previous: number; percentChange: number | null }>`
  - `getFunnelConversion(orgId: string, range: DateRange): Promise<FunnelConversionResult[]>`
  - `getSalesSummary(orgId: string, range: DateRange): Promise<{ count: number; total: number }>`
  - `getCapiHealth(orgId: string, range: DateRange): Promise<CapiHealthResult>`

Sem teste automatizado dedicado — segue o mesmo padrão de `lib/leads/queries.ts` e `lib/contacts/queries.ts` (funções finas de I/O sem teste unitário próprio; a lógica de verdade já está testada em `aggregations.ts`). Validação é via typecheck + verificação manual no dashboard (Task 6).

- [ ] **Step 1: Criar `lib/dashboard/queries.ts`**

```typescript
import { createClient } from "@/lib/supabase/server";
import {
  bucketCountsByDay,
  computeCapiHealth,
  computeFunnelConversion,
  computePercentChange,
  sumSaleValues,
  type CapiHealthResult,
  type DateRange,
  type FunnelConversionResult,
  type LeadsCountPoint,
} from "./aggregations";

function previousPeriod(range: DateRange): DateRange {
  const durationMs = range.to.getTime() - range.from.getTime();
  return {
    from: new Date(range.from.getTime() - durationMs),
    to: new Date(range.from.getTime()),
  };
}

export async function getLeadsCountSeries(
  orgId: string,
  range: DateRange,
): Promise<LeadsCountPoint[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leads")
    .select("created_at")
    .eq("organization_id", orgId)
    .gte("created_at", range.from.toISOString())
    .lte("created_at", range.to.toISOString());
  if (error) throw error;
  return bucketCountsByDay((data ?? []).map((r) => r.created_at), range);
}

export async function getLeadsCountComparison(
  orgId: string,
  range: DateRange,
): Promise<{ current: number; previous: number; percentChange: number | null }> {
  const supabase = await createClient();
  const prev = previousPeriod(range);

  const [current, previous] = await Promise.all([
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .gte("created_at", range.from.toISOString())
      .lte("created_at", range.to.toISOString()),
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .gte("created_at", prev.from.toISOString())
      .lte("created_at", prev.to.toISOString()),
  ]);

  if (current.error) throw current.error;
  if (previous.error) throw previous.error;

  const currentCount = current.count ?? 0;
  const previousCount = previous.count ?? 0;
  return {
    current: currentCount,
    previous: previousCount,
    percentChange: computePercentChange(currentCount, previousCount),
  };
}

export async function getFunnelConversion(
  orgId: string,
  range: DateRange,
): Promise<FunnelConversionResult[]> {
  const supabase = await createClient();

  const { data: stages, error: stagesError } = await supabase
    .from("funnel_stages")
    .select("id, name, position")
    .eq("organization_id", orgId)
    .order("position", { ascending: true });
  if (stagesError) throw stagesError;

  const { data: transitions, error: transitionsError } = await supabase
    .from("lead_stage_history")
    .select("to_stage_id")
    .eq("organization_id", orgId)
    .gte("changed_at", range.from.toISOString())
    .lte("changed_at", range.to.toISOString());
  if (transitionsError) throw transitionsError;

  const transitionCounts: Record<string, number> = {};
  for (const row of transitions ?? []) {
    transitionCounts[row.to_stage_id] = (transitionCounts[row.to_stage_id] ?? 0) + 1;
  }

  return computeFunnelConversion(stages ?? [], transitionCounts);
}

export async function getSalesSummary(
  orgId: string,
  range: DateRange,
): Promise<{ count: number; total: number }> {
  const supabase = await createClient();

  const { data: purchaseStages, error: stagesError } = await supabase
    .from("funnel_stages")
    .select("id")
    .eq("organization_id", orgId)
    .eq("meta_event", "Purchase");
  if (stagesError) throw stagesError;

  const purchaseStageIds = (purchaseStages ?? []).map((s) => s.id);
  if (purchaseStageIds.length === 0) return { count: 0, total: 0 };

  const { data: transitions, error: transitionsError } = await supabase
    .from("lead_stage_history")
    .select("lead_id")
    .eq("organization_id", orgId)
    .in("to_stage_id", purchaseStageIds)
    .gte("changed_at", range.from.toISOString())
    .lte("changed_at", range.to.toISOString());
  if (transitionsError) throw transitionsError;

  const leadIds = [...new Set((transitions ?? []).map((t) => t.lead_id))];
  if (leadIds.length === 0) return { count: 0, total: 0 };

  const { data: leads, error: leadsError } = await supabase
    .from("leads")
    .select("sale_value")
    .in("id", leadIds);
  if (leadsError) throw leadsError;

  return {
    count: leadIds.length,
    total: sumSaleValues((leads ?? []).map((l) => l.sale_value)),
  };
}

export async function getCapiHealth(orgId: string, range: DateRange): Promise<CapiHealthResult> {
  const supabase = await createClient();

  const { data: transitions, error: transitionsError } = await supabase
    .from("lead_stage_history")
    .select("lead_id")
    .eq("organization_id", orgId)
    .gte("changed_at", range.from.toISOString())
    .lte("changed_at", range.to.toISOString());
  if (transitionsError) throw transitionsError;

  const leadIds = [...new Set((transitions ?? []).map((t) => t.lead_id))];
  if (leadIds.length === 0) return { success: 0, error: 0 };

  const { data: leads, error: leadsError } = await supabase
    .from("leads")
    .select("meta_error")
    .in("id", leadIds);
  if (leadsError) throw leadsError;

  return computeCapiHealth((leads ?? []).map((l) => l.meta_error));
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Esperado: zero erros.

- [ ] **Step 3: Commit**

```bash
git add lib/dashboard/queries.ts
git commit -m "feat: add dashboard query functions backed by real Supabase data"
```

---

## Task 5: Componentes de tela do dashboard

**Files:**
- Create: `app/(app)/app/[orgSlug]/dashboard/period-selector.tsx`
- Modify: `app/(app)/app/[orgSlug]/dashboard/kpi-card.tsx`
- Create: `app/(app)/app/[orgSlug]/dashboard/leads-over-time-chart.tsx`
- Create: `app/(app)/app/[orgSlug]/dashboard/funnel-conversion-chart.tsx`
- Create: `app/(app)/app/[orgSlug]/dashboard/capi-health-card.tsx`
- Delete: `app/(app)/app/[orgSlug]/dashboard/dashboard-chart.tsx`

**Interfaces:**
- Consumes: `FunnelConversionResult`, `LeadsCountPoint` de `@/lib/dashboard/aggregations` (Task 3)
- Produces:
  - `PeriodSelector({ current }: { current: string })` — Client Component
  - `KpiCard({ label, value, percentChange }: { label: string; value: string; percentChange: number | null })`
  - `LeadsOverTimeChart({ data }: { data: LeadsCountPoint[] })`
  - `FunnelConversionChart({ data }: { data: FunnelConversionResult[] })`
  - `CapiHealthCard({ success, error }: { success: number; error: number })`

**Nota de escopo:** o `KpiCard` atual tem um sparkline (mini-gráfico) por card, alimentado pelo mock. Como nem toda métrica real tem uma série diária própria (ex: vendas fechadas, saúde do CAPI), essa versão simplifica o card pra label + valor + variação %, sem sparkline. Se sentir falta do sparkline depois, dá pra adicionar de volta pontualmente no card de "leads novos" (que tem série diária via `getLeadsCountSeries`).

- [ ] **Step 1: Criar `period-selector.tsx`**

```tsx
"use client";

import { useRouter, useSearchParams } from "next/navigation";

const PERIODS = [
  { value: "7", label: "7 dias" },
  { value: "30", label: "30 dias" },
  { value: "90", label: "90 dias" },
] as const;

export function PeriodSelector({ current }: { current: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function selectPeriod(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("period", value);
    router.push(`?${params.toString()}`);
  }

  return (
    <div className="flex items-center gap-1 rounded-full border border-border/60 bg-card/60 p-1">
      {PERIODS.map((p) => (
        <button
          key={p.value}
          type="button"
          onClick={() => selectPeriod(p.value)}
          className={`rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${
            current === p.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Substituir o conteúdo de `kpi-card.tsx`**

```tsx
import { ArrowDownIcon, ArrowUpIcon, MinusIcon } from "lucide-react";

type Props = {
  label: string;
  value: string;
  percentChange: number | null;
};

export function KpiCard({ label, value, percentChange }: Props) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-border bg-card glow-hover surface-highlight">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/0 to-transparent transition-all group-hover:via-primary/60" />

      <div className="p-5">
        <div className="flex items-start justify-between">
          <span className="label-mono">{label}</span>
          {percentChange !== null && (
            <div
              className={`flex items-center gap-0.5 font-mono text-[10px] tracking-wide ${
                percentChange >= 0 ? "text-primary" : "text-destructive"
              }`}
            >
              {percentChange === 0 ? (
                <MinusIcon className="h-3 w-3" />
              ) : percentChange > 0 ? (
                <ArrowUpIcon className="h-3 w-3" />
              ) : (
                <ArrowDownIcon className="h-3 w-3" />
              )}
              {percentChange > 0 ? "+" : ""}
              {percentChange}%
            </div>
          )}
        </div>

        <div className="mt-3 font-semibold text-3xl tracking-tight tabular-nums">{value}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Criar `leads-over-time-chart.tsx`**

```tsx
"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { LeadsCountPoint } from "@/lib/dashboard/aggregations";

const chartConfig = {
  count: { label: "Leads", color: "var(--color-chart-1)" },
} satisfies ChartConfig;

export function LeadsOverTimeChart({ data }: { data: LeadsCountPoint[] }) {
  return (
    <ChartContainer config={chartConfig} className="h-72 w-full">
      <AreaChart data={data} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="count-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-count)" stopOpacity={0.45} />
            <stop offset="100%" stopColor="var(--color-count)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid
          strokeDasharray="2 6"
          vertical={false}
          stroke="currentColor"
          strokeOpacity={0.08}
        />
        <XAxis
          dataKey="date"
          tickFormatter={(d: string) =>
            new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
          }
          fontSize={10}
          tickLine={false}
          axisLine={false}
          stroke="currentColor"
          opacity={0.5}
          minTickGap={32}
        />
        <YAxis
          fontSize={10}
          tickLine={false}
          axisLine={false}
          stroke="currentColor"
          opacity={0.5}
          width={48}
          allowDecimals={false}
        />
        <ChartTooltip
          cursor={{ stroke: "var(--color-count)", strokeDasharray: "3 3", strokeOpacity: 0.4 }}
          content={<ChartTooltipContent indicator="line" />}
        />
        <Area
          dataKey="count"
          type="monotone"
          stroke="var(--color-count)"
          fill="url(#count-fill)"
          strokeWidth={2}
          isAnimationActive={false}
          activeDot={{
            r: 5,
            fill: "var(--color-count)",
            stroke: "var(--color-card)",
            strokeWidth: 3,
          }}
        />
      </AreaChart>
    </ChartContainer>
  );
}
```

- [ ] **Step 4: Criar `funnel-conversion-chart.tsx`**

```tsx
"use client";

import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { FunnelConversionResult } from "@/lib/dashboard/aggregations";

const chartConfig = {
  count: { label: "Leads", color: "var(--color-chart-1)" },
} satisfies ChartConfig;

export function FunnelConversionChart({ data }: { data: FunnelConversionResult[] }) {
  const chartData = data.map((stage) => ({
    ...stage,
    displayLabel:
      stage.conversionPct === null ? `${stage.count}` : `${stage.count} (${stage.conversionPct}%)`,
  }));

  return (
    <ChartContainer config={chartConfig} className="h-72 w-full">
      <BarChart
        data={chartData}
        layout="vertical"
        margin={{ top: 12, right: 56, bottom: 0, left: 12 }}
      >
        <CartesianGrid
          strokeDasharray="2 6"
          horizontal={false}
          stroke="currentColor"
          strokeOpacity={0.08}
        />
        <XAxis
          type="number"
          fontSize={10}
          tickLine={false}
          axisLine={false}
          stroke="currentColor"
          opacity={0.5}
          allowDecimals={false}
        />
        <YAxis
          type="category"
          dataKey="name"
          fontSize={10}
          tickLine={false}
          axisLine={false}
          stroke="currentColor"
          opacity={0.5}
          width={110}
        />
        <ChartTooltip
          cursor={{ fill: "var(--color-count)", fillOpacity: 0.08 }}
          content={<ChartTooltipContent indicator="line" />}
        />
        <Bar dataKey="count" fill="var(--color-count)" radius={4}>
          <LabelList dataKey="displayLabel" position="right" fontSize={10} className="fill-foreground" />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
```

- [ ] **Step 5: Criar `capi-health-card.tsx`**

```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Props = { success: number; error: number };

export function CapiHealthCard({ success, error }: Props) {
  const total = success + error;
  const errorRate = total === 0 ? 0 : Math.round((error / total) * 100);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-border/60 bg-card/40 py-3">
        <CardTitle className="flex items-center gap-2 font-medium text-sm">
          <span className="label-mono">/ saúde do rastreamento (CAPI)</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-6 p-5">
        <div>
          <div className="label-mono">Enviados com sucesso</div>
          <div className="mt-1 font-semibold text-2xl tabular-nums">{success}</div>
        </div>
        <div>
          <div className="label-mono">Com erro</div>
          <div className="mt-1 font-semibold text-2xl text-destructive tabular-nums">{error}</div>
        </div>
        {total > 0 && (
          <div>
            <div className="label-mono">Taxa de erro</div>
            <div className="mt-1 font-semibold text-2xl tabular-nums">{errorRate}%</div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 6: Remover `dashboard-chart.tsx`**

```bash
git rm "app/(app)/app/[orgSlug]/dashboard/dashboard-chart.tsx"
```

- [ ] **Step 7: Typecheck**

Vai falhar até a Task 6 atualizar `page.tsx` (que ainda importa `dashboard-chart.tsx` e o `Kpi` do mock) — isso é esperado neste ponto. Confirme que o único erro restante é em `page.tsx`:

```bash
npx tsc --noEmit
```

Esperado: erros apontando só para `app/(app)/app/[orgSlug]/dashboard/page.tsx` (import de `dashboard-chart` e uso antigo de `KpiCard`).

- [ ] **Step 8: Commit**

```bash
git add "app/(app)/app/[orgSlug]/dashboard/period-selector.tsx" \
  "app/(app)/app/[orgSlug]/dashboard/kpi-card.tsx" \
  "app/(app)/app/[orgSlug]/dashboard/leads-over-time-chart.tsx" \
  "app/(app)/app/[orgSlug]/dashboard/funnel-conversion-chart.tsx" \
  "app/(app)/app/[orgSlug]/dashboard/capi-health-card.tsx"
git commit -m "feat: add real-data dashboard components (period selector, charts, capi health card)"
```

---

## Task 6: `page.tsx` — montar o dashboard real e remover os mocks

**Files:**
- Modify: `app/(app)/app/[orgSlug]/dashboard/page.tsx`
- Delete: `lib/mock/dashboard.ts`

**Interfaces:**
- Consumes: todas as funções de `@/lib/dashboard/queries` (Task 4) e todos os componentes da Task 5
- Produces: dashboard funcional com dados reais, sem nenhuma referência a `lib/mock/dashboard.ts`

- [ ] **Step 1: Substituir o conteúdo de `page.tsx`**

```tsx
import { EmptyState } from "@/components/app/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOrgMember } from "@/lib/auth/guards";
import {
  getCapiHealth,
  getFunnelConversion,
  getLeadsCountComparison,
  getLeadsCountSeries,
  getSalesSummary,
} from "@/lib/dashboard/queries";
import type { DateRange } from "@/lib/dashboard/aggregations";
import { createClient } from "@/lib/supabase/server";
import { CapiHealthCard } from "./capi-health-card";
import { FunnelConversionChart } from "./funnel-conversion-chart";
import { KpiCard } from "./kpi-card";
import { LeadsOverTimeChart } from "./leads-over-time-chart";
import { PeriodSelector } from "./period-selector";

type Props = {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ period?: string }>;
};

export const metadata = { title: "Início" };

const VALID_PERIODS = ["7", "30", "90"] as const;

function resolvePeriod(raw: string | undefined): (typeof VALID_PERIODS)[number] {
  return VALID_PERIODS.includes(raw as (typeof VALID_PERIODS)[number])
    ? (raw as (typeof VALID_PERIODS)[number])
    : "30";
}

function periodRange(days: number): DateRange {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return { from, to };
}

export default async function DashboardPage({ params, searchParams }: Props) {
  const { orgSlug } = await params;
  const { period: rawPeriod } = await searchParams;
  const { user, org } = await requireOrgMember({ orgSlug });

  const period = resolvePeriod(rawPeriod);
  const range = periodRange(Number(period));

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();
  const displayName = profile?.full_name ?? user.email ?? "";

  const [series, comparison, funnel, sales, capiHealth] = await Promise.all([
    getLeadsCountSeries(org.id, range),
    getLeadsCountComparison(org.id, range),
    getFunnelConversion(org.id, range),
    getSalesSummary(org.id, range),
    getCapiHealth(org.id, range),
  ]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1.5">
          <div className="label-mono">/ overview</div>
          <h1 className="font-semibold text-3xl tracking-tight">Bem-vindo, {displayName}</h1>
          <p className="text-muted-foreground text-sm">
            Workspace <span className="text-foreground/80">{org.name}</span>
          </p>
        </div>
        <PeriodSelector current={period} />
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Leads novos"
          value={String(comparison.current)}
          percentChange={comparison.percentChange}
        />
        <KpiCard
          label="Vendas fechadas"
          value={String(sales.count)}
          percentChange={null}
        />
        <KpiCard
          label="Valor total vendido"
          value={sales.total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
          percentChange={null}
        />
        <CapiHealthCard success={capiHealth.success} error={capiHealth.error} />
      </div>

      {/* Chart de evolução */}
      <Card className="overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between border-b border-border/60 bg-card/40 py-3">
          <CardTitle className="flex items-center gap-2 font-medium text-sm">
            <span className="label-mono">/ leads novos</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-5">
          <LeadsOverTimeChart data={series} />
        </CardContent>
      </Card>

      {/* Funil de conversão */}
      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border/60 bg-card/40 py-3">
          <CardTitle className="flex items-center gap-2 font-medium text-sm">
            <span className="label-mono">/ funil de conversão</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-5">
          {funnel.length === 0 ? (
            <EmptyState
              title="Nenhuma etapa configurada"
              description="Configure as etapas do funil em Configurações → Funil para ver o gráfico de conversão."
            />
          ) : (
            <FunnelConversionChart data={funnel} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Remover o mock que não é mais usado**

```bash
git rm lib/mock/dashboard.ts
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

Esperado: zero erros.

- [ ] **Step 4: Build completo**

```bash
npm run build
```

Esperado: build sem erro.

- [ ] **Step 5: Rodar toda a suite de testes**

```bash
npm run test
```

Esperado: todos os testes passando, zero falhas.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/app/[orgSlug]/dashboard/page.tsx"
git commit -m "feat: wire dashboard to real leads data, remove mock KPIs and chart"
```

- [ ] **Step 7: Validação manual**

Abra `npm run dev`, navegue até `/app/<sua-org>/dashboard`, e confirme:
- Os 4 cards mostram números reais (não mais "1.234 usuários ativos" etc.)
- Trocar o seletor de período (7/30/90 dias) atualiza os números e os gráficos
- O gráfico de funil mostra as etapas na ordem certa, com contagem e % de conversão
- Se a organização não tiver etapas configuradas, aparece a mensagem de setup em vez de gráfico quebrado
- Mover um lead no Kanban (`/app/<sua-org>/leads`) e voltar ao dashboard reflete a mudança no funil

---

## Validação final pós-implementação

1. **Migration aplicada e tipos regenerados** — `types/supabase.ts` inclui `lead_stage_history`
2. **`npx tsc --noEmit`** — zero erros
3. **`npm run build`** — build completo sem erro
4. **`npm run test`** — todos os testes passando (incluindo os novos de `leads-actions-history` e `dashboard-aggregations`)
5. **Verificação manual no navegador** — dashboard mostra dados reais, seletor de período funciona, funil bate com o Kanban de leads
