import { logError } from "@/lib/logger";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Cria um lead a partir de uma conversa nova no webhook.
 * Usa service client — sem sessão de usuário no contexto do webhook.
 * Idempotente via UNIQUE(conversation_id).
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
  if (error && (error as { code?: string }).code !== "23505") {
    logError("leads.webhook-create", error);
  }
}
