# WhatsApp CAPI Tracking — Design Spec
**Data:** 2026-06-29
**Status:** Aprovado

## Problema

O CRM já integra WhatsApp Evolution e Meta CAPI, mas os dois sistemas não se falam. Quando um lead chega via anúncio Click-to-WhatsApp:

- O `ctwaClid` (fbclid do Click-to-WhatsApp) é descartado pelo webhook
- O CAPI manda só hash de telefone + nome — EMQ ~3/10
- Nenhum evento é disparado automaticamente na conversa
- O Meta não sabe distinguir quem apenas clicou de quem conversou de verdade

**Objetivo:** EMQ de ~3 para 7–8, disparo automático de `Lead` e `Contact` com `fbc` + `external_id`, arquitetura extensível para landing page (fase 2).

---

## Escopo desta implementação (fase 1)

### Fora do escopo (fase 2 — landing page)
- Captura de email (`em`) na página antes de redirecionar pro WhatsApp
- IP e user agent do cliente
- UTMs completos via URL da landing page
- Rota pública `POST /api/tracking/session`

---

## Banco de dados

### Migration: `conversations` — duas novas colunas

```sql
ALTER TABLE public.conversations
  ADD COLUMN tracking jsonb DEFAULT NULL,
  ADD COLUMN capi_contact_fired boolean NOT NULL DEFAULT false;
```

**`tracking` (jsonb):** armazena dados de origem do lead. Estrutura:
```json
{
  "ctwa_clid":        "AZr...",
  "fbc":              "fb.1.1719619200.AZr...",
  "fbp":              null,
  "ad_id":            "120212345678",
  "source_url":       "https://...",
  "utm_source":       null,
  "utm_medium":       null,
  "utm_campaign":     null,
  "utm_content":      null,
  "client_ip":        null,
  "client_user_agent": null,
  "em":               null
}
```
Campos `null` na fase 1 são preenchidos automaticamente na fase 2 sem alterar esta estrutura.

**`capi_contact_fired` (boolean):** garante que o evento `Contact` dispara exatamente uma vez por conversa, mesmo que o lead mande múltiplas mensagens.

---

## Extração do `ctwaClid` no webhook da Evolution

**Arquivo:** `lib/messaging/adapters/whatsapp-evolution/parse-webhook.ts`

### Onde vem no payload da Evolution

Click-to-WhatsApp direto:
```json
{
  "event": "messages.upsert",
  "data": {
    "referralInfo": {
      "ctwaClid": "AZr...",
      "adId": "120212345678",
      "sourceUrl": "https://..."
    }
  }
}
```

Anúncio com link (fallback):
```json
{
  "data": {
    "contextInfo": {
      "externalAdReply": {
        "ctwaClid": "AZr...",
        "adId": "120212345678",
        "sourceUrl": "https://..."
      }
    }
  }
}
```

### Como é processado

1. `parse-webhook.ts` extrai `ctwaClid`, `adId`, `sourceUrl` de `referralInfo` ou `contextInfo.externalAdReply` (nessa ordem de prioridade)
2. Monta `fbc = "fb.1.{Math.floor(Date.now()/1000)}.{ctwaClid}"`
3. Adiciona campo `tracking` ao `NormalizedEvent`:

```typescript
type NormalizedEvent = {
  // ... campos existentes ...
  tracking?: {
    ctwa_clid: string | null
    fbc: string | null
    ad_id: string | null
    source_url: string | null
  }
}
```

### Regras
- Se não houver `referralInfo` nem `contextInfo.externalAdReply`: `tracking` é `undefined` (conversa orgânica — não salva nada)
- `fbc` só é montado se `ctwaClid` existir
- Não sobrescreve `tracking` em mensagens subsequentes da mesma conversa (só a primeira importa)

---

## Router — gravar tracking na conversa

**Arquivo:** `lib/messaging/router.ts`, função `upsertConversation`

Quando `normalizedEvent.tracking` existe e a conversa está sendo **criada** (não atualizada), grava `tracking` na coluna recém-adicionada.

```typescript
// Só na criação — não sobrescreve se a conversa já existe
if (isNewConversation && event.tracking) {
  await supabase
    .from("conversations")
    .update({ tracking: event.tracking })
    .eq("id", conversationId)
}
```

---

## CAPI Client — campos expandidos

**Arquivo:** `lib/meta-capi/client.ts`

### Campos adicionados ao `user_data`

| Campo | Fonte | Fase |
|---|---|---|
| `fbc` | `conversations.tracking.fbc` | 1 (agora) |
| `external_id` | `conversationId` (hash SHA-256) | 1 (agora) |
| `em` | `conversations.tracking.em` | 2 (landing page) |
| `client_ip_address` | `conversations.tracking.client_ip` | 2 (landing page) |
| `client_user_agent` | `conversations.tracking.client_user_agent` | 2 (landing page) |

### Regra de envio
Campos `null` ou `undefined` são omitidos do payload — o Meta ignora campos ausentes, não penaliza.

### `action_source`
Mantém `"system_generated"` para eventos do WhatsApp (correto para CAPI server-side sem interação browser).

---

## Disparo automático: evento `Lead`

**Arquivo:** `lib/leads/webhook.ts`, função `createLeadFromWebhook`

### Quando
Imediatamente após inserir o lead no banco (primeira mensagem inbound de uma conversa nova).

### Como
```
after(() => fireCapiWhatsappLead(lead, conversation))
```

Função `fireCapiWhatsappLead`:
1. Busca `pixel_id` e `capi_token` de `meta_integrations` por `organization_id` (mesmo padrão de `sendCapiEvent` existente)
2. Se não existir pixel configurado: encerra silenciosamente (sem erro)
3. Monta `user_data` com `ph`, `fn`, `fbc`, `external_id` (+ `em`/`ip`/`ua` quando disponíveis)
4. Chama `sendCapiEvent` com `event_name: "Lead"` e `event_id: "wpp_lead_{conversationId}"`

### Deduplicação
`event_id` fixo por conversa (`wpp_lead_{conversationId}`) garante que reprocessamentos não duplicam o evento no Meta.

---

## Disparo automático: evento `Contact`

**Arquivo:** `lib/messaging/router.ts`, função `processInboundMessage`

### Quando
Mensagem inbound chega **E**:
1. A conversa já tem pelo menos uma mensagem `outbound` (bot ou atendente respondeu)
2. `conversations.capi_contact_fired = false`

### Como
```typescript
const hasOutbound = await checkConversationHasOutbound(conversationId)
if (hasOutbound && !conversation.capi_contact_fired) {
  await supabase
    .from("conversations")
    .update({ capi_contact_fired: true })
    .eq("id", conversationId)

  after(() => fireCapiWhatsappContact(conversation))
}
```

Setar `capi_contact_fired = true` **antes** do `after()` evita race condition se duas mensagens chegarem simultâneas.

### `event_id`
`"wpp_contact_{conversationId}"` — único por conversa, deduplicação automática.

---

## Arquitetura de funções CAPI (novo arquivo)

**Arquivo:** `lib/meta-capi/whatsapp-events.ts`

Centraliza os disparos de eventos CAPI originados do WhatsApp:
- `fireCapiWhatsappLead(lead, conversation)` — busca pixel da org, monta payload, chama client
- `fireCapiWhatsappContact(conversation)` — idem, evento Contact
- `buildWhatsappUserData(conversation, lead?)` — monta `user_data` a partir do `tracking` da conversa

Separado de `lib/meta-capi/events.ts` (que serve o funil de leads) para não misturar as duas origens.

---

## Busca do pixel da org

Reutiliza o padrão já existente em `lib/meta-capi/client.ts`: busca `pixel_id` e `capi_token` na tabela `meta_integrations` pelo `organization_id` via service client. As funções em `lib/meta-capi/whatsapp-events.ts` chamam `createServiceClient()` e fazem a query diretamente — sem arquivo `queries.ts` extra. Retorna `null` se org não tiver integração Meta configurada — disparo é silenciosamente ignorado.

---

## Extensibilidade — Fase 2 (Landing Page)

Quando existir landing page antes do WhatsApp:

1. A página captura `fbclid` da URL, email do formulário, IP e user agent
2. Chama `POST /api/tracking/session` (nova rota pública, sem auth)
3. Essa rota associa os dados ao número de telefone (via parâmetro UTM ou cookie)
4. Quando a conversa é criada no webhook, faz merge com os dados da sessão de tracking
5. Os campos `em`, `client_ip`, `client_user_agent`, `utm_*` em `conversations.tracking` são preenchidos

**Nenhum código da fase 1 precisa mudar.** O CAPI client já lê esses campos — simplesmente passam de `null` para preenchidos.

---

## Checklist de validação

- [ ] Pixel Helper: `Lead` dispara quando primeira mensagem chega
- [ ] Pixel Helper: `Contact` dispara quando lead responde após outbound (1x só)
- [ ] Events Manager → Test Events: `event_id` igual no client e server (deduplicado)
- [ ] `conversations.tracking` tem `fbc` preenchido em conversas de anúncios
- [ ] `conversations.tracking` é `null` em conversas orgânicas (sem anúncio)
- [ ] `capi_contact_fired` = true após primeiro Contact, não dispara de novo
- [ ] EMQ ≥ 6.0 no Events Manager (meta: ≥ 8.0)
- [ ] Org sem pixel configurado: sem erro, sem disparo silencioso

---

## Arquivos criados/modificados

| Arquivo | Tipo | O que muda |
|---|---|---|
| `supabase/migrations/20260629000000_conversations_tracking.sql` | Novo | Colunas `tracking` e `capi_contact_fired` |
| `lib/messaging/adapters/whatsapp-evolution/parse-webhook.ts` | Modificado | Extrai `referralInfo` → campo `tracking` |
| `lib/messaging/adapter.ts` | Modificado | `NormalizedEvent` ganha campo `tracking?` |
| `lib/messaging/router.ts` | Modificado | Grava `tracking` na criação + lógica Contact |
| `lib/leads/webhook.ts` | Modificado | Dispara CAPI Lead após criar lead |
| `lib/meta-capi/client.ts` | Modificado | Aceita `fbc`, `external_id`, `em`, `client_ip`, `client_user_agent` |
| `lib/meta-capi/whatsapp-events.ts` | Novo | `fireCapiWhatsappLead`, `fireCapiWhatsappContact`, `buildWhatsappUserData` |
| `lib/meta-capi/queries.ts` | Novo/Modificado | `getOrgPixelConfig(orgId)` |
