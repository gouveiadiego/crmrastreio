import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { logError } from "@/lib/logger";
import type { Database } from "@/types/supabase";

export type FunnelStage = Database["public"]["Tables"]["funnel_stages"]["Row"];

export async function getStagesByOrg(orgId: string): Promise<FunnelStage[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("funnel_stages")
    .select(
      "id, organization_id, name, meta_event, color, position, requires_value, is_system, created_at",
    )
    .eq("organization_id", orgId)
    .order("position", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function getFirstStage(orgId: string): Promise<FunnelStage | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("funnel_stages")
    .select(
      "id, organization_id, name, meta_event, color, position, requires_value, is_system, created_at",
    )
    .eq("organization_id", orgId)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Versão sem sessão de usuário — usa service client.
 * Chamada pelo router de mensagens (contexto de webhook).
 * Filtra por is_system=true para não retornar etapa errada após reordenação.
 */
export async function getFirstStageSystem(
  orgId: string,
): Promise<FunnelStage | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("funnel_stages")
    .select(
      "id, organization_id, name, meta_event, color, position, requires_value, is_system, created_at",
    )
    .eq("organization_id", orgId)
    .eq("is_system", true)
    .limit(1)
    .maybeSingle();
  if (error) {
    logError("leads.stages.first-system", error);
    return null;
  }
  return data;
}

/** Cria a etapa padrão "Não Classificado" se a org ainda não tiver nenhuma etapa de sistema.
 *  Idempotente: o índice único parcial (is_system = true) garante que acessos simultâneos
 *  não criem duplicatas — o segundo insert recebe 23505 e é ignorado silenciosamente.
 */
export async function seedDefaultStageSystem(orgId: string): Promise<void> {
  try {
    const supabase = createServiceClient();
    const { error } = await supabase.from("funnel_stages").insert({
      organization_id: orgId,
      name: "Não Classificado",
      is_system: true,
      color: "#6b7280",
      meta_event: "Lead",
      requires_value: false,
      position: 0,
    });
    // 23505 = unique_violation → já existe, tudo certo
    if (error && (error as { code?: string }).code !== "23505") {
      logError("leads.stages.seed-default", error);
    }
  } catch (err) {
    logError("leads.stages.seed-default", err);
  }
}
