# WhatsApp CAPI Tracking — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capturar `ctwaClid` de anúncios Click-to-WhatsApp, armazenar em `conversations.tracking`, e disparar eventos CAPI `Lead` (1ª mensagem) e `Contact` (lead responde após outbound) com `fbc` + `external_id` — subindo EMQ de ~3 para 7–8.

**Architecture:** O webhook da Evolution extrai `referralInfo.ctwaClid`, monta `fbc`, e inclui no `NormalizedEvent.tracking`. O router salva esse campo na conversa recém-criada. `lib/meta-capi/whatsapp-events.ts` centraliza o payload e os disparos CAPI; `leads/webhook.ts` dispara Lead após criar o lead; o router dispara Contact quando o lead responde depois de uma mensagem outbound (1x por conversa via flag `capi_contact_fired`).

**Tech Stack:** Next.js 16 App Router, Supabase (PostgreSQL + service client), Vitest, TypeScript strict, Meta Conversions API v22.0.

## Global Constraints

- TypeScript strict — zero `any`, zero `@ts-ignore`
- `createServiceClient()` para todas as queries server-side sem sessão
- Eventos CAPI nunca lançam exceção — erro é logado e engolido
- `fbc` vai **cru** no payload (não hashear) — Meta interpreta diretamente
- `ph`, `fn`, `em`, `external_id` são arrays de SHA-256 hex
- `event_id` fixo por conversa — deduplicação automática no Meta
- Após cada migration: rodar `npm run types` para regenerar `types/supabase.ts`
- Após cada task: `npx tsc --noEmit` deve retornar zero erros

---

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `supabase/migrations/20260629120000_conversations_tracking.sql` | Criar | Colunas `tracking jsonb` e `capi_contact_fired bool` |
| `lib/messaging/adapter.ts` | Modificar | Campo `tracking?` em `NormalizedEvent` |
| `lib/messaging/adapters/whatsapp-evolution/parse-webhook.ts` | Modificar | Extrair `referralInfo`/`contextInfo.externalAdReply` → `tracking` |
| `lib/meta-capi/whatsapp-events.ts` | Criar | `buildCapiWhatsappPayload`, `fireCapiWhatsappLead`, `fireCapiWhatsappContact` |
| `lib/messaging/router.ts` | Modificar | Salvar tracking na criação + disparar Contact |
| `lib/leads/webhook.ts` | Modificar | Disparar CAPI Lead após inserir lead |
| `tests/messaging-evolution-parse-webhook-tracking.test.ts` | Criar | Testes de extração de tracking |
| `tests/meta-capi-whatsapp-events.test.ts` | Criar | Testes de buildCapiWhatsappPayload |

---

## Task 1: Migration — conversations.tracking + capi_contact_fired

**Files:**
- Create: `supabase/migrations/20260629120000_conversations_tracking.sql`

**Interfaces:**
- Produces: colunas `tracking jsonb DEFAULT NULL` e `capi_contact_fired boolean NOT NULL DEFAULT false` na tabela `conversations`; tipos regenerados em `types/supabase.ts`

- [ ] **Step 1: Criar o arquivo de migration**

```sql
-- supabase/migrations/20260629120000_conversations_tracking.sql
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS tracking jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS capi_contact_fired boolean NOT NULL DEFAULT false;
```

- [ ] **Step 2: Aplicar a migration no Supabase**

Cole o SQL acima no Supabase SQL Editor → Run. Confirme que executa sem erro.

- [ ] **Step 3: Regenerar os tipos TypeScript**

```bash
npm run types
```

Esperado: `types/supabase.ts` atualizado. Confirme que `conversations` Row agora tem `tracking: Json | null` e `capi_contact_fired: boolean`.

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit
```

Esperado: zero erros.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260629120000_conversations_tracking.sql types/supabase.ts
git commit -m "feat: add tracking jsonb + capi_contact_fired to conversations"
```

---

## Task 2: NormalizedEvent + parse-webhook — extração do ctwaClid

**Files:**
- Modify: `lib/messaging/adapter.ts`
- Modify: `lib/messaging/adapters/whatsapp-evolution/parse-webhook.ts`
- Create: `tests/messaging-evolution-parse-webhook-tracking.test.ts`

**Interfaces:**
- Produces: `NormalizedEvent.tracking?: { ctwa_clid: string | null; fbc: string | null; ad_id: string | null; source_url: string | null }`
- Consumes: nada de tasks anteriores

- [ ] **Step 1: Escrever os testes (falharão inicialmente)**

Crie `tests/messaging-evolution-parse-webhook-tracking.test.ts`:

```typescript
import { parseWebhook } from "@/lib/messaging/adapters/whatsapp-evolution/parse-webhook";
import { describe, expect, it } from "vitest";

const BASE_UPSERT = {
  event: "messages.upsert",
  instance: "test-instance",
  data: {
    key: { remoteJid: "5511999999999@s.whatsapp.net", id: "msg-1", fromMe: false },
    messageType: "conversation",
    message: { conversation: "oi" },
    messageTimestamp: 1719619200,
    pushName: "João",
  },
};

describe("parseWebhook — tracking extraction", () => {
  it("extrai ctwaClid de referralInfo e monta fbc", () => {
    const payload = {
      ...BASE_UPSERT,
      data: {
        ...BASE_UPSERT.data,
        referralInfo: {
          ctwaClid: "AZrXXX",
          adId: "12345",
          sourceUrl: "https://fb.com/ad/123",
        },
      },
    };
    const [event] = parseWebhook(payload);
    expect(event.tracking).toBeDefined();
    expect(event.tracking?.ctwa_clid).toBe("AZrXXX");
    expect(event.tracking?.fbc).toMatch(/^fb\.1\.\d+\.AZrXXX$/);
    expect(event.tracking?.ad_id).toBe("12345");
    expect(event.tracking?.source_url).toBe("https://fb.com/ad/123");
  });

  it("usa contextInfo.externalAdReply como fallback", () => {
    const payload = {
      ...BASE_UPSERT,
      data: {
        ...BASE_UPSERT.data,
        contextInfo: {
          externalAdReply: { ctwaClid: "AZrYYY", adId: "99999" },
        },
      },
    };
    const [event] = parseWebhook(payload);
    expect(event.tracking?.ctwa_clid).toBe("AZrYYY");
    expect(event.tracking?.fbc).toMatch(/^fb\.1\.\d+\.AZrYYY$/);
  });

  it("referralInfo tem precedência sobre contextInfo", () => {
    const payload = {
      ...BASE_UPSERT,
      data: {
        ...BASE_UPSERT.data,
        referralInfo: { ctwaClid: "PRIORITY" },
        contextInfo: { externalAdReply: { ctwaClid: "FALLBACK" } },
      },
    };
    const [event] = parseWebhook(payload);
    expect(event.tracking?.ctwa_clid).toBe("PRIORITY");
  });

  it("retorna tracking undefined quando não há ctwaClid", () => {
    const [event] = parseWebhook(BASE_UPSERT);
    expect(event.tracking).toBeUndefined();
  });

  it("retorna tracking undefined quando referralInfo existe mas sem ctwaClid", () => {
    const payload = {
      ...BASE_UPSERT,
      data: { ...BASE_UPSERT.data, referralInfo: { adId: "123" } },
    };
    const [event] = parseWebhook(payload);
    expect(event.tracking).toBeUndefined();
  });
});
```

- [ ] **Step 2: Rodar testes para confirmar que falham**

```bash
npm run test -- tests/messaging-evolution-parse-webhook-tracking.test.ts
```

Esperado: FAIL — "Cannot read properties of undefined (reading 'tracking')"

- [ ] **Step 3: Adicionar campo `tracking` em `NormalizedEvent`**

Em `lib/messaging/adapter.ts`, adicione após o campo `raw: unknown`:

```typescript
export interface NormalizedEvent {
  kind: "message" | "status" | "reaction";
  externalThreadId: string;
  externalMessageId: string;
  contactName?: string;
  fromMe?: boolean;
  timestamp: string;

  message?: {
    body?: string;
    media?: NormalizedMediaAttachment[];
    replyToExternalId?: string;
  };

  status?: {
    value: "sent" | "delivered" | "read" | "failed";
    failureReason?: string;
  };

  reaction?: {
    emoji: string;
    targetExternalMessageId: string;
  };

  tracking?: {
    ctwa_clid: string | null;
    fbc: string | null;
    ad_id: string | null;
    source_url: string | null;
  };

  raw: unknown;
}
```

- [ ] **Step 4: Adicionar extração em `parse-webhook.ts`**

Em `lib/messaging/adapters/whatsapp-evolution/parse-webhook.ts`, adicione a função auxiliar antes de `parseMessageUpsert`:

```typescript
function extractTracking(
  data: Record<string, unknown>,
): NonNullable<NormalizedEvent["tracking"]> | undefined {
  const referral = data.referralInfo as Record<string, unknown> | undefined;
  const contextInfo = data.contextInfo as Record<string, unknown> | undefined;
  const adReply = contextInfo?.externalAdReply as Record<string, unknown> | undefined;

  const ctwaClid =
    (typeof referral?.ctwaClid === "string" ? referral.ctwaClid : null) ??
    (typeof adReply?.ctwaClid === "string" ? adReply.ctwaClid : null);

  if (!ctwaClid) return undefined;

  const adId =
    (typeof referral?.adId === "string" ? referral.adId : null) ??
    (typeof adReply?.adId === "string" ? adReply.adId : null);

  const sourceUrl =
    (typeof referral?.sourceUrl === "string" ? referral.sourceUrl : null) ??
    (typeof adReply?.sourceUrl === "string" ? adReply.sourceUrl : null);

  const fbc = `fb.1.${Math.floor(Date.now() / 1000)}.${ctwaClid}`;

  return { ctwa_clid: ctwaClid, fbc, ad_id: adId, source_url: sourceUrl };
}
```

Depois, em `parseMessageUpsert`, adicione a extração e inclua `tracking` no objeto retornado:

```typescript
function parseMessageUpsert(payload: Payload): NormalizedEvent[] {
  const data = payload.data ?? {};
  const key = data.key as Record<string, unknown> | undefined;
  const remoteJid = typeof key?.remoteJid === "string" ? key.remoteJid : null;
  const externalMessageId = typeof key?.id === "string" ? key.id : null;
  const fromMe = key?.fromMe === true;
  if (!remoteJid || !externalMessageId) return [];

  const messageType = typeof data.messageType === "string" ? data.messageType : undefined;
  const message = data.message as Record<string, unknown> | undefined;
  const timestamp = typeof data.messageTimestamp === "number" ? data.messageTimestamp : 0;
  const pushName =
    typeof data.pushName === "string" && data.pushName.trim().length > 0
      ? data.pushName.trim()
      : undefined;

  const extracted = extractMessageContent(messageType, message);
  const media: NormalizedMediaAttachment[] | undefined = extracted.mimeType
    ? [{ externalMediaId: externalMessageId, mimeType: extracted.mimeType }]
    : undefined;

  const tracking = extractTracking(data);

  return [
    {
      kind: "message",
      externalThreadId: jidToPhone(remoteJid),
      externalMessageId,
      contactName: pushName,
      fromMe,
      timestamp: isoFromUnixSeconds(timestamp),
      message: {
        body: extracted.body,
        media,
      },
      tracking,
      raw: { instanceName: payload.instance, ...payload },
    },
  ];
}
```

- [ ] **Step 5: Rodar testes para confirmar que passam**

```bash
npm run test -- tests/messaging-evolution-parse-webhook-tracking.test.ts
```

Esperado: PASS — 5 testes passando.

- [ ] **Step 6: Rodar suite completa de parse-webhook para garantir regressão zero**

```bash
npm run test -- tests/messaging-evolution-parse-webhook.test.ts
```

Esperado: PASS.

- [ ] **Step 7: Typecheck**

```bash
npx tsc --noEmit
```

Esperado: zero erros.

- [ ] **Step 8: Commit**

```bash
git add lib/messaging/adapter.ts lib/messaging/adapters/whatsapp-evolution/parse-webhook.ts tests/messaging-evolution-parse-webhook-tracking.test.ts
git commit -m "feat: extract ctwaClid from Evolution referralInfo into NormalizedEvent.tracking"
```

---

## Task 3: router.ts — salvar tracking na criação da conversa

**Files:**
- Modify: `lib/messaging/router.ts`

**Interfaces:**
- Consumes: `NormalizedEvent.tracking` (Task 2); colunas `tracking` e `capi_contact_fired` na DB (Task 1)
- Produces: `conversations.tracking` preenchido em conversas vindas de anúncios

- [ ] **Step 1: Atualizar o select do `existingConv` para incluir novos campos**

Em `lib/messaging/router.ts`, localize a query de busca da conversa existente (linha ~183). Troque a lista de campos:

```typescript
const { data: existingConv } = await supabase
  .from("conversations")
  .select("id, organization_id, agent_status, display_name, capi_contact_fired, tracking")
  .eq("channel_id", channel.id)
  .eq("external_thread_id", externalThread)
  .maybeSingle();
```

- [ ] **Step 2: Salvar tracking no INSERT da nova conversa**

Localize o `supabase.from("conversations").insert({...})` (~linha 232). Adicione o campo `tracking`:

```typescript
const { data: newConv, error: convErr } = await supabase
  .from("conversations")
  .insert({
    organization_id: channel.organization_id,
    channel_id: channel.id,
    contact_id: contactId,
    external_thread_id: externalThread,
    display_name: incomingDisplayName,
    status: "open",
    ...(event.tracking
      ? { tracking: event.tracking as import("@/types/supabase").Json }
      : {}),
  })
  .select("id, agent_status")
  .single();
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

Esperado: zero erros.

- [ ] **Step 4: Commit**

```bash
git add lib/messaging/router.ts
git commit -m "feat: save conversation.tracking from NormalizedEvent on conversation creation"
```

---

## Task 4: lib/meta-capi/whatsapp-events.ts — payload builder + disparadores

**Files:**
- Create: `lib/meta-capi/whatsapp-events.ts`
- Create: `tests/meta-capi-whatsapp-events.test.ts`

**Interfaces:**
- Consumes: `hashPhone`, `hashField` de `./hash`; `META_GRAPH_VERSION` de `./client`; `createServiceClient` de `@/lib/supabase/service`
- Produces:
  - `WhatsappCapiTracking` — interface de tracking
  - `FireCapiWhatsappOpts` — interface de parâmetros
  - `buildCapiWhatsappPayload(eventName, opts)` — puro, sem I/O
  - `fireCapiWhatsappLead(opts)` — dispara Lead no CAPI
  - `fireCapiWhatsappContact(opts)` — dispara Contact no CAPI

- [ ] **Step 1: Escrever os testes (falharão inicialmente)**

Crie `tests/meta-capi-whatsapp-events.test.ts`:

```typescript
import { buildCapiWhatsappPayload } from "@/lib/meta-capi/whatsapp-events";
import { describe, expect, it } from "vitest";

const BASE_OPTS = {
  conversationId: "conv-abc-123",
  phone: "+5511987654321",
  name: "João Silva",
  tracking: null,
};

describe("buildCapiWhatsappPayload", () => {
  it("monta event_name e event_id corretos para Lead", () => {
    const payload = buildCapiWhatsappPayload("Lead", BASE_OPTS) as Record<string, unknown>;
    expect(payload.event_name).toBe("Lead");
    expect(payload.event_id).toBe("wpp_lead_conv-abc-123");
    expect(payload.action_source).toBe("system_generated");
    expect(typeof payload.event_time).toBe("number");
  });

  it("monta event_name e event_id corretos para Contact", () => {
    const payload = buildCapiWhatsappPayload("Contact", BASE_OPTS) as Record<string, unknown>;
    expect(payload.event_name).toBe("Contact");
    expect(payload.event_id).toBe("wpp_contact_conv-abc-123");
  });

  it("inclui hash SHA-256 de telefone em user_data.ph", () => {
    const payload = buildCapiWhatsappPayload("Lead", BASE_OPTS) as Record<string, unknown>;
    const ud = payload.user_data as Record<string, unknown>;
    expect(Array.isArray(ud.ph)).toBe(true);
    expect((ud.ph as string[])[0]).toMatch(/^[a-f0-9]{64}$/);
  });

  it("inclui hash SHA-256 de nome em user_data.fn", () => {
    const payload = buildCapiWhatsappPayload("Lead", BASE_OPTS) as Record<string, unknown>;
    const ud = payload.user_data as Record<string, unknown>;
    expect(Array.isArray(ud.fn)).toBe(true);
    expect((ud.fn as string[])[0]).toMatch(/^[a-f0-9]{64}$/);
  });

  it("inclui external_id como hash SHA-256 do conversationId", () => {
    const payload = buildCapiWhatsappPayload("Lead", BASE_OPTS) as Record<string, unknown>;
    const ud = payload.user_data as Record<string, unknown>;
    expect(Array.isArray(ud.external_id)).toBe(true);
    expect((ud.external_id as string[])[0]).toMatch(/^[a-f0-9]{64}$/);
  });

  it("inclui fbc cru (não hasheado) quando tracking.fbc presente", () => {
    const payload = buildCapiWhatsappPayload("Lead", {
      ...BASE_OPTS,
      tracking: { fbc: "fb.1.1719619200.AZrXXX" },
    }) as Record<string, unknown>;
    const ud = payload.user_data as Record<string, unknown>;
    expect(ud.fbc).toBe("fb.1.1719619200.AZrXXX");
  });

  it("não inclui fbc quando tracking é null", () => {
    const payload = buildCapiWhatsappPayload("Lead", BASE_OPTS) as Record<string, unknown>;
    const ud = payload.user_data as Record<string, unknown>;
    expect(ud.fbc).toBeUndefined();
  });

  it("inclui hash SHA-256 de email quando tracking.em presente", () => {
    const payload = buildCapiWhatsappPayload("Lead", {
      ...BASE_OPTS,
      tracking: { em: "test@example.com" },
    }) as Record<string, unknown>;
    const ud = payload.user_data as Record<string, unknown>;
    expect(Array.isArray(ud.em)).toBe(true);
    expect((ud.em as string[])[0]).toMatch(/^[a-f0-9]{64}$/);
  });

  it("funciona sem telefone e sem nome (apenas external_id)", () => {
    const payload = buildCapiWhatsappPayload("Lead", {
      ...BASE_OPTS,
      phone: null,
      name: null,
    }) as Record<string, unknown>;
    const ud = payload.user_data as Record<string, unknown>;
    expect(ud.ph).toBeUndefined();
    expect(ud.fn).toBeUndefined();
    expect(ud.external_id).toBeDefined();
  });

  it("inclui client_ip_address quando tracking.client_ip presente", () => {
    const payload = buildCapiWhatsappPayload("Lead", {
      ...BASE_OPTS,
      tracking: { client_ip: "177.100.200.50" },
    }) as Record<string, unknown>;
    const ud = payload.user_data as Record<string, unknown>;
    expect(ud.client_ip_address).toBe("177.100.200.50");
  });
});
```

- [ ] **Step 2: Rodar testes para confirmar que falham**

```bash
npm run test -- tests/meta-capi-whatsapp-events.test.ts
```

Esperado: FAIL — módulo não encontrado.

- [ ] **Step 3: Criar `lib/meta-capi/whatsapp-events.ts`**

```typescript
import { createHash } from "node:crypto";
import { logError } from "@/lib/logger";
import { createServiceClient } from "@/lib/supabase/service";
import { META_GRAPH_VERSION } from "./client";
import { hashField, hashPhone } from "./hash";

export interface WhatsappCapiTracking {
  ctwa_clid?: string | null;
  fbc?: string | null;
  ad_id?: string | null;
  source_url?: string | null;
  em?: string | null;
  client_ip?: string | null;
  client_user_agent?: string | null;
}

export interface FireCapiWhatsappOpts {
  organizationId: string;
  conversationId: string;
  phone: string | null;
  name: string | null;
  tracking: WhatsappCapiTracking | null;
}

export function buildCapiWhatsappPayload(
  eventName: "Lead" | "Contact",
  opts: Omit<FireCapiWhatsappOpts, "organizationId">,
): Record<string, unknown> {
  const { conversationId, phone, name, tracking } = opts;
  const userData: Record<string, unknown> = {};

  const phoneHash = hashPhone(phone);
  if (phoneHash) userData.ph = [phoneHash];

  const firstName = name?.split(" ")[0] ?? null;
  const nameHash = hashField(firstName);
  if (nameHash) userData.fn = [nameHash];

  // external_id: hash SHA-256 do conversationId — identificador estável por conversa
  userData.external_id = [createHash("sha256").update(conversationId).digest("hex")];

  // fbc vai cru — Meta interpreta diretamente, não hashear
  if (tracking?.fbc) userData.fbc = tracking.fbc;

  // em: hashear SHA-256 (fase 2 — landing page)
  if (tracking?.em) {
    const emHash = hashField(tracking.em);
    if (emHash) userData.em = [emHash];
  }

  // client_ip e client_user_agent: crus (fase 2 — landing page)
  if (tracking?.client_ip) userData.client_ip_address = tracking.client_ip;
  if (tracking?.client_user_agent) userData.client_user_agent = tracking.client_user_agent;

  return {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_id: `wpp_${eventName.toLowerCase()}_${conversationId}`,
    action_source: "system_generated",
    user_data: userData,
  };
}

async function sendWhatsappCapiEvent(
  eventName: "Lead" | "Contact",
  opts: FireCapiWhatsappOpts,
): Promise<void> {
  try {
    const supabase = createServiceClient();
    const { data: integration } = await supabase
      .from("meta_integrations")
      .select("pixel_id, capi_token")
      .eq("organization_id", opts.organizationId)
      .maybeSingle();

    if (!integration) return; // org sem Meta configurado — silencioso

    const payload = buildCapiWhatsappPayload(eventName, opts);
    const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${integration.pixel_id}/events`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: [payload], access_token: integration.capi_token }),
    });

    if (!res.ok) {
      const body = await res.text();
      logError(
        `meta-capi.whatsapp.${eventName.toLowerCase()}`,
        new Error(`HTTP ${res.status}: ${body}`),
      );
    }
  } catch (err) {
    logError(`meta-capi.whatsapp.${eventName.toLowerCase()}`, err);
  }
}

export function fireCapiWhatsappLead(opts: FireCapiWhatsappOpts): Promise<void> {
  return sendWhatsappCapiEvent("Lead", opts);
}

export function fireCapiWhatsappContact(opts: FireCapiWhatsappOpts): Promise<void> {
  return sendWhatsappCapiEvent("Contact", opts);
}
```

- [ ] **Step 4: Rodar testes para confirmar que passam**

```bash
npm run test -- tests/meta-capi-whatsapp-events.test.ts
```

Esperado: PASS — 10 testes passando.

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit
```

Esperado: zero erros.

- [ ] **Step 6: Commit**

```bash
git add lib/meta-capi/whatsapp-events.ts tests/meta-capi-whatsapp-events.test.ts
git commit -m "feat: add WhatsApp CAPI event builders (Lead + Contact) with fbc + external_id"
```

---

## Task 5: leads/webhook.ts — disparar CAPI Lead após criar lead

**Files:**
- Modify: `lib/leads/webhook.ts`

**Interfaces:**
- Consumes:
  - `fireCapiWhatsappLead(opts: FireCapiWhatsappOpts)` de `@/lib/meta-capi/whatsapp-events` (Task 4)
  - `WhatsappCapiTracking` de `@/lib/meta-capi/whatsapp-events` (Task 4)
  - coluna `conversations.tracking` na DB (Task 1)
- Produces: evento CAPI `Lead` enviado à Meta após cada lead criado por webhook

- [ ] **Step 1: Atualizar `lib/leads/webhook.ts`**

Substitua o conteúdo completo do arquivo:

```typescript
import { logError } from "@/lib/logger";
import { fireCapiWhatsappLead, type WhatsappCapiTracking } from "@/lib/meta-capi/whatsapp-events";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Cria um lead a partir de uma conversa nova no webhook.
 * Usa service client — sem sessão de usuário no contexto do webhook.
 * Idempotente via UNIQUE(conversation_id).
 * Após criar, dispara CAPI Lead com tracking da conversa.
 * @internal — não é Server Action, não chamar de Client Component.
 */
export async function createLeadFromWebhook(opts: {
  organizationId: string;
  conversationId: string;
  funnel_stage_id: string;
  phone: string | null;
  name: string | null;
}): Promise<void> {
  const supabase = createServiceClient();

  const { error } = await supabase.from("leads").insert({
    organization_id: opts.organizationId,
    funnel_stage_id: opts.funnel_stage_id,
    conversation_id: opts.conversationId,
    phone: opts.phone,
    name: opts.name,
  });

  // 23505 = unique_violation (conversa já tem lead) — ignorar silenciosamente
  if (error) {
    if ((error as { code?: string }).code !== "23505") {
      logError("leads.webhook-create", error);
    }
    return;
  }

  // Busca tracking da conversa (salvo pelo router no momento da criação)
  const { data: conv } = await supabase
    .from("conversations")
    .select("tracking")
    .eq("id", opts.conversationId)
    .maybeSingle();

  const tracking = (conv?.tracking ?? null) as WhatsappCapiTracking | null;

  await fireCapiWhatsappLead({
    organizationId: opts.organizationId,
    conversationId: opts.conversationId,
    phone: opts.phone,
    name: opts.name,
    tracking,
  });
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Esperado: zero erros.

- [ ] **Step 3: Commit**

```bash
git add lib/leads/webhook.ts
git commit -m "feat: fire CAPI Lead with fbc + external_id after webhook lead creation"
```

---

## Task 6: router.ts — disparar CAPI Contact quando lead responde após outbound

**Files:**
- Modify: `lib/messaging/router.ts`

**Interfaces:**
- Consumes:
  - `fireCapiWhatsappContact(opts)` de `@/lib/meta-capi/whatsapp-events` (Task 4)
  - `WhatsappCapiTracking` de `@/lib/meta-capi/whatsapp-events` (Task 4)
  - `conversations.capi_contact_fired` e `conversations.tracking` na DB (Task 1)
  - select atualizado do `existingConv` (Task 3)
- Produces: evento CAPI `Contact` enviado à Meta (1x por conversa) quando lead responde após mensagem outbound

- [ ] **Step 1: Adicionar import de `fireCapiWhatsappContact` e `WhatsappCapiTracking`**

No topo de `lib/messaging/router.ts`, adicione:

```typescript
import {
  fireCapiWhatsappContact,
  type WhatsappCapiTracking,
} from "@/lib/meta-capi/whatsapp-events";
```

- [ ] **Step 2: Adicionar lógica de Contact após o bloco de atualização de timestamps**

Localize o trecho que atualiza timestamps (~linha 388–437). Logo **após** esse bloco e **antes** do bloco do agente, adicione:

```typescript
  // CAPI Contact: dispara quando lead responde depois do bot/atendente (1x por conversa).
  // Condições: mensagem inbound + conversa já existia + flag false + há outbound anterior.
  if (!isOutbound && existingConv && !existingConv.capi_contact_fired && insertedMsg) {
    const { count } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conversationId)
      .eq("direction", "outbound");

    if ((count ?? 0) > 0) {
      // Seta flag ANTES do after() para evitar race condition com mensagens simultâneas
      await supabase
        .from("conversations")
        .update({ capi_contact_fired: true })
        .eq("id", conversationId);

      const orgId = channel.organization_id;
      const convId = conversationId;
      const phone = normalizePhone(externalThread);
      const convTracking = (existingConv.tracking ?? null) as WhatsappCapiTracking | null;
      const convName = existingConv.display_name ?? null;
      after(() =>
        fireCapiWhatsappContact({
          organizationId: orgId,
          conversationId: convId,
          phone,
          name: convName,
          tracking: convTracking,
        }),
      );
    }
  }
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

- [ ] **Step 6: Commit final**

```bash
git add lib/messaging/router.ts
git commit -m "feat: fire CAPI Contact when lead replies after outbound message (1x per conversation)"
```

---

## Validação final pós-implementação

Após todos os commits, verificar no Events Manager do Meta:

1. **`conversations.tracking` preenchido** — abra o Supabase Studio, filtre conversas criadas após deploy. Conversas de anúncios Click-to-WhatsApp devem ter `tracking.fbc` não nulo. Conversas orgânicas devem ter `tracking = null`.

2. **Evento Lead chega no Meta** — no Events Manager → Test Events, mande uma mensagem de um WhatsApp de teste que tenha chegado via anúncio. Confirme evento `Lead` com `event_id = wpp_lead_{id}`.

3. **Evento Contact chega 1x** — responda da inbox, depois mande uma segunda mensagem do WhatsApp de teste. Confirme evento `Contact` com mesmo `conversationId`. Mande uma terceira mensagem — o Contact **não** deve disparar novamente (`capi_contact_fired = true`).

4. **EMQ** — no Events Manager → Visão geral → cada evento deve mostrar EMQ ≥ 6.0 (alvo: ≥ 8.0 após algumas conversas reais com `fbc` preenchido).
