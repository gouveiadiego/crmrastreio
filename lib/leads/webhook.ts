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
