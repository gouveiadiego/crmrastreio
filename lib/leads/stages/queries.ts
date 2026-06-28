import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import type { Database } from "@/types/supabase";

export type FunnelStage = Database["public"]["Tables"]["funnel_stages"]["Row"];

export async function getStagesByOrg(orgId: string): Promise<FunnelStage[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("funnel_stages")
    .select(
      "id, organization_id, name, meta_event, color, position, requires_value, created_at",
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
      "id, organization_id, name, meta_event, color, position, requires_value, created_at",
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
 */
export async function getFirstStageSystem(
  orgId: string,
): Promise<FunnelStage | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("funnel_stages")
    .select(
      "id, organization_id, name, meta_event, color, position, requires_value, created_at",
    )
    .eq("organization_id", orgId)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}
