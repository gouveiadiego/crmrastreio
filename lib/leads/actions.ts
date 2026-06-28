"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrgMember, requireOrgRole } from "@/lib/auth/guards";
import { logError } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendCapiEvent } from "@/lib/meta-capi/client";
import type { TablesUpdate } from "@/types/supabase";
import {
  type CreateLeadInput,
  createLeadSchema,
  type DeleteLeadInput,
  deleteLeadSchema,
  type MoveLeadInput,
  moveLeadSchema,
  type UpdateLeadInput,
  updateLeadSchema,
} from "./schemas";

type ActionResult<T = void> = { ok: true; data?: T } | { ok: false; error: string };

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

  revalidatePath(`/app/${parsed.data.orgSlug}/leads`);
  return { ok: true, data: { id: data.id } };
}

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

  // Busca lead pra pegar phone/name pro CAPI
  const { data: lead } = await supabase
    .from("leads")
    .select("id, phone, name")
    .eq("id", parsed.data.leadId)
    .eq("organization_id", org.id)
    .maybeSingle();

  if (!lead) return { ok: false, error: "Lead não encontrado." };

  const { error } = await supabase
    .from("leads")
    .update({
      funnel_stage_id: parsed.data.newStageId,
      sale_value: parsed.data.saleValue ?? null,
    })
    .eq("id", parsed.data.leadId)
    .eq("organization_id", org.id);

  if (error) {
    logError("leads.move", error);
    return { ok: false, error: "Erro ao mover lead. Tente novamente." };
  }

  revalidatePath(`/app/${parsed.data.orgSlug}/leads`);

  // Dispara evento CAPI em background — não bloqueia a resposta
  if (stage.meta_event) {
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

export async function updateLeadAction(input: UpdateLeadInput): Promise<ActionResult> {
  const parsed = updateLeadSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };

  const { org } = await requireOrgMember({ orgSlug: parsed.data.orgSlug });
  const supabase = await createClient();

  const patch: TablesUpdate<"leads"> = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.phone !== undefined) patch.phone = parsed.data.phone;

  const { error } = await supabase
    .from("leads")
    .update(patch)
    .eq("id", parsed.data.leadId)
    .eq("organization_id", org.id);

  if (error) {
    logError("leads.update", error);
    return { ok: false, error: "Erro ao atualizar lead. Tente novamente." };
  }

  revalidatePath(`/app/${parsed.data.orgSlug}/leads`);
  return { ok: true };
}

export async function deleteLeadAction(input: DeleteLeadInput): Promise<ActionResult> {
  const parsed = deleteLeadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos" };

  const { org } = await requireOrgRole({ orgSlug: parsed.data.orgSlug, roles: ["owner", "admin"] });
  const supabase = await createClient();

  const { error } = await supabase
    .from("leads")
    .delete()
    .eq("id", parsed.data.leadId)
    .eq("organization_id", org.id);

  if (error) {
    logError("leads.delete", error);
    return { ok: false, error: "Erro ao excluir lead. Tente novamente." };
  }

  revalidatePath(`/app/${parsed.data.orgSlug}/leads`);
  return { ok: true };
}

/**
 * Chamada diretamente pelo router de mensagens (sem sessão de usuário).
 * Usa service client pois roda no after() do webhook.
 * Idempotente: ON CONFLICT (conversation_id) DO NOTHING.
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
  // 23505 = unique_violation (conversation já tem lead) — ignorar silenciosamente
  if (error && (error as { code?: string }).code !== "23505") {
    logError("leads.webhook-create", error);
  }
}

// ─── Meta CAPI Integration ────────────────────────────────────────────────────

const saveMetaIntegrationSchema = z.object({
  orgSlug: z.string(),
  pixel_id: z.string().min(1),
  capi_token: z.string().min(1),
});

const testMetaIntegrationSchema = z.object({
  orgSlug: z.string(),
});

export async function saveMetaIntegrationAction(
  input: z.infer<typeof saveMetaIntegrationSchema>,
): Promise<ActionResult> {
  const parsed = saveMetaIntegrationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos" };

  const { org } = await requireOrgRole({
    orgSlug: parsed.data.orgSlug,
    roles: ["owner", "admin"],
  });
  const supabase = await createClient();

  const { error } = await supabase
    .from("meta_integrations")
    .upsert(
      {
        organization_id: org.id,
        pixel_id: parsed.data.pixel_id,
        capi_token: parsed.data.capi_token,
      },
      { onConflict: "organization_id" },
    );

  if (error) {
    logError("meta-integration.save", error);
    return { ok: false, error: "Erro ao salvar configuração. Tente novamente." };
  }

  revalidatePath(`/app/${parsed.data.orgSlug}/settings/integrations`);
  return { ok: true };
}

export async function testMetaIntegrationAction(
  input: z.infer<typeof testMetaIntegrationSchema>,
): Promise<ActionResult<{ message: string }>> {
  const parsed = testMetaIntegrationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos" };

  const { org } = await requireOrgRole({
    orgSlug: parsed.data.orgSlug,
    roles: ["owner", "admin"],
  });

  // Busca credenciais via service client — não serializa capi_token pro browser
  const supabase = createServiceClient();
  const { data: integration } = await supabase
    .from("meta_integrations")
    .select("pixel_id, capi_token")
    .eq("organization_id", org.id)
    .maybeSingle();

  if (!integration) {
    return { ok: false, error: "Configure Pixel ID e Token antes de testar." };
  }

  const META_GRAPH_VERSION = "v19.0";
  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${integration.pixel_id}/events`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: [
          {
            event_name: "LeadTest",
            event_time: Math.floor(Date.now() / 1000),
            event_id: `test_${Date.now()}`,
            action_source: "system_generated",
            user_data: {},
          },
        ],
        access_token: integration.capi_token,
      }),
    });

    if (!res.ok) {
      return { ok: false, error: `Meta retornou erro: ${res.status}` };
    }

    return { ok: true, data: { message: "Conexão com Meta confirmada!" } };
  } catch {
    return { ok: false, error: "Não foi possível conectar ao Meta. Verifique o Token." };
  }
}
