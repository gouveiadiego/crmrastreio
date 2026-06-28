# Design: Funil de Leads WhatsApp + Meta CAPI

**Data:** 2026-06-28  
**Status:** Aprovado — aguardando implementação  
**Autor:** Diego Gouveia + Claude Code

---

## Contexto e objetivo

Diego é dono de uma agência de tráfego pago para negócios locais com 8 clientes. Cada cliente tem seu próprio workspace no CRM (organização separada) e um número WhatsApp conectado via Evolution API.

O objetivo é transformar o CRM num sistema de rastreamento de leads de WhatsApp: quando um lead entra pelo WhatsApp (vindo de anúncio no Meta Ads), ele aparece automaticamente num kanban de qualificação. Conforme o atendente qualifica o lead (movendo o card manualmente), o sistema envia eventos direto para a Meta Conversions API — sem n8n, sem intermediário — permitindo que o Meta Ads otimize as campanhas com dados reais de qualidade de lead e venda.

---

## O que já existe (não precisa construir)

- WhatsApp via Evolution API — conectado e funcionando (`lib/messaging/adapters/whatsapp-evolution/`)
- Inbox com conversas em tempo real (`app/(app)/app/[orgSlug]/inbox/`)
- Módulo de contatos (`lib/contacts/`)
- Arquitetura multi-tenant com RLS por `organization_id`

---

## Arquitetura — visão geral do fluxo

```
Lead manda mensagem no WhatsApp do cliente
        ↓
Evolution API → Webhook → processInboundMessage() [existente]
        ↓
Cria conversa + contato [existente]
        ↓  [NOVO]
É conversa nova? → Cria card na tabela leads (etapa "Novo")
        ↓
Cliente vê card no kanban /leads
Lê conversa na Inbox, decide mover o card
        ↓
Arrasta card para nova etapa → Server Action
        ↓
1. Atualiza funnel_stage_id no banco
2. Lê Pixel ID + Token CAPI da org (servidor apenas)
3. Hasheia telefone do lead com SHA-256
4. POST para Meta CAPI com evento mapeado
        ↓
Meta Ads recebe sinal → otimiza campanha
```

---

## Banco de dados — 3 tabelas novas

### `funnel_stages` — etapas personalizáveis por org

```sql
create table public.funnel_stages (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  meta_event      text,             -- 'Lead', 'CompleteRegistration', 'Schedule',
                                    -- 'InitiateCheckout', 'Purchase', 'LeadLost', null
  color           text not null default '#6b7280',
  position        integer not null default 0,
  requires_value  boolean not null default false,  -- true apenas em Purchase
  created_at      timestamptz not null default now()
);

alter table public.funnel_stages enable row level security;
-- RLS: is_org_member(organization_id)
```

Regras:
- `meta_event = 'Purchase'` implica `requires_value = true`
- Etapas sem `meta_event` (null) não disparam nenhum evento Meta
- Org pode ter quantas etapas quiser, em qualquer ordem

### `leads` — os cards do kanban

```sql
create table public.leads (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  funnel_stage_id  uuid not null references public.funnel_stages(id),
  conversation_id  uuid references public.conversations(id),
  contact_id       uuid references public.contacts(id),
  name             text,
  phone            text,            -- formato: 5511987654321 (DDI + número, só dígitos)
  sale_value       numeric(10,2),   -- preenchido quando etapa tem requires_value = true
  last_meta_event  text,            -- último evento enviado ao Meta
  meta_error       text,            -- erro da última tentativa CAPI (null = sucesso)
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint leads_conversation_id_unique unique (conversation_id)  -- 1 lead por conversa
);

alter table public.leads enable row level security;
-- RLS: is_org_member(organization_id)
```

Regras:
- `UNIQUE (conversation_id)` garante idempotência: 1 lead por conversa
- Se o webhook disparar duas vezes para a mesma conversa, o segundo é ignorado (`ON CONFLICT DO NOTHING`)
- `meta_error` não nulo = evento CAPI falhou; exibir aviso na tela de integrações

### `meta_integrations` — credenciais Meta por org

```sql
create table public.meta_integrations (
  organization_id  uuid primary key references public.organizations(id) on delete cascade,
  pixel_id         text not null,
  capi_token       text not null,   -- NUNCA enviado ao browser
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.meta_integrations enable row level security;
-- RLS: is_org_member para SELECT; has_org_role(owner, admin) para INSERT/UPDATE/DELETE
-- capi_token lido APENAS em Server Actions via createServiceClient()
```

---

## Módulo de código — `lib/leads/`

Segue o mesmo padrão de `lib/tasks/` e `lib/contacts/`.

```
lib/leads/
  schemas.ts        — Zod: CreateLeadSchema, MoveLeadSchema, UpdateLeadSchema
  queries.ts        — getLeadsByOrg(), getLeadById(), getLeadByConversation()
  actions.ts        — createLeadAction, moveLeadAction, updateLeadAction
  stages/
    queries.ts      — getStagesByOrg(), getFirstStage()
    actions.ts      — createStageAction, updateStageAction, deleteStageAction, reorderStagesAction

lib/meta-capi/
  client.ts         — sendCapiEvent(orgId, leadId, event, value?) — chamada HTTP ao Meta
  hash.ts           — hashPhone(phone): string — SHA-256 conforme especificação Meta
  events.ts         — mapeamento meta_event → payload CAPI
```

---

## `moveLeadAction` — Server Action principal

Executado quando o cliente arrasta um card no kanban.

```
Entrada: { leadId, newStageId, saleValue? }

1. requireOrgMember() — garante que quem move é membro da org
2. Valida com Zod
3. Busca lead + stage destino no banco
4. Se stage.requires_value e saleValue ausente → retorna erro (UI já bloqueou, mas valida server-side)
5. UPDATE leads SET funnel_stage_id, sale_value, updated_at
6. revalidatePath('/leads')
7. after() → sendCapiEvent() [não bloqueia a resposta]
   — Lê meta_integrations da org (service client)
   — Se não configurado: registra log, retorna silenciosamente
   — Monta payload com telefone hasheado + evento + valor
   — POST https://graph.facebook.com/v19.0/{pixelId}/events
   — Em erro: UPDATE leads SET meta_error = mensagem
   — Em sucesso: UPDATE leads SET last_meta_event, meta_error = null
8. Retorna { ok: true }
```

O `after()` garante que a resposta volta pro browser **antes** da chamada ao Meta — o card move instantâneo, o evento CAPI vai em background.

---

## Webhook — criação automática do lead

Ponto de integração: `lib/messaging/router.ts` → função `processInboundMessage`.

Após criar a conversa (conversa nova apenas):

```typescript
// Só age em conversas novas (conversationWasCreated = true)
if (conversationWasCreated) {
  const firstStage = await getFirstStage(channel.organization_id);
  if (firstStage) {
    await createLead({
      organizationId: channel.organization_id,
      conversationId: conversation.id,
      funnel_stage_id: firstStage.id,
      phone: normalizePhone(externalThreadId),
      name: senderName ?? null,
    });
    // ON CONFLICT (conversation_id) DO NOTHING — idempotente
  }
}
```

`normalizePhone`: remove `+`, espaços e caracteres não numéricos → formato `5511987654321`.

---

## Payload Meta CAPI — formato exato

```json
{
  "data": [{
    "event_name": "Purchase",
    "event_time": 1719532800,
    "event_id": "lead_{leadId}_{stageId}",
    "action_source": "system_generated",
    "user_data": {
      "ph": ["a3f9c2d1..."],
      "fn": ["joao_hash..."]
    },
    "custom_data": {
      "value": 1500.00,
      "currency": "BRL"
    }
  }],
  "access_token": "TOKEN_CAPI"
}
```

- `event_id` único por (lead × etapa) — evita contagem dupla se o cliente mover e voltar
- `ph` = SHA-256 do telefone em minúsculas, sem espaços
- `fn` = SHA-256 do primeiro nome em minúsculas (quando disponível)
- `action_source = "system_generated"` = evento gerado por CRM, não por clique no site

---

## Rotas da aplicação

| Rota | O que é |
|---|---|
| `/app/[orgSlug]/leads` | Kanban de leads — página principal |
| `/app/[orgSlug]/settings/funnel` | Configurar etapas + mapear eventos Meta |
| `/app/[orgSlug]/settings/integrations` | Pixel ID + Token CAPI da Meta |

---

## UI — Kanban `/leads`

- Colunas = `funnel_stages` da org ordenadas por `position`
- Cards = `leads` agrupados por `funnel_stage_id`
- Drag-and-drop entre colunas (biblioteca: `@dnd-kit/core` — já usada no projeto)
- Card exibe: nome/telefone, tempo desde criação, contagem de mensagens, link para Inbox
- Ao mover para etapa `requires_value = true` → modal pede valor antes de confirmar
- Botão no header: "Configurar funil" → `/settings/funnel`

## UI — Configurar etapas `/settings/funnel`

- Lista de etapas reordenável (drag-and-drop)
- Cada item: nome editável inline, seletor de cor, dropdown de evento Meta, ícone de excluir
- Excluir etapa com leads → aviso: "X leads nessa etapa serão movidos para a anterior"
- Botão "Adicionar etapa" → modal com campos: nome, cor, evento Meta

## UI — Integrações `/settings/integrations`

- Campo Pixel ID (texto)
- Campo Token CAPI (input password, mascarado)
- Botão "Testar conexão" → Server Action faz chamada teste ao Meta e retorna ok/erro
- Status: "Conectado — último evento há 2h" ou "Erro: token inválido"

---

## Mapeamento de eventos por etapa padrão

| Etapa sugerida | Evento Meta | Valor? |
|---|---|---|
| Novo | `Lead` | Não |
| Qualificado | `CompleteRegistration` | Não |
| Agendado | `Schedule` | Não |
| Quase Comprou | `InitiateCheckout` | Recomendado |
| Comprou | `Purchase` | **Obrigatório** |
| Perdido | `LeadLost` (custom) | Não |

O cliente pode criar etapas diferentes com nomes e eventos à sua escolha.

---

## Segurança

1. `capi_token` lido apenas via `createServiceClient()` em Server Actions — nunca serializado pro browser
2. Telefone hasheado com SHA-256 antes de sair do servidor — nunca enviado em claro para o Meta
3. RLS em todas as tabelas — dados de uma org nunca acessíveis por outra
4. `has_org_role(['owner', 'admin'])` para criar/editar/excluir etapas e configurar Meta
5. Membros comuns só podem mover cards

---

## Fora do escopo desta versão (fase 2)

- Google Ads Enhanced Conversions (requer aprovação de developer token)
- IA que lê conversa e move card automaticamente (`lib/agent/` — já existe, integrar depois)
- Dashboard com métricas de conversão por etapa
- Notificação para o atendente quando lead fica parado há X dias
- Exportação de leads para CSV
