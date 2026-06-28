"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
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
