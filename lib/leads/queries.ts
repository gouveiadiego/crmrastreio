import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/supabase";

export type Lead = Database["public"]["Tables"]["leads"]["Row"];

export type LeadWithStage = Lead & {
  stage: {
    id: string;
    name: string;
    color: string;
    meta_event: string | null;
    requires_value: boolean;
    position: number;
  };
};

export async function getLeadsByOrg(orgId: string): Promise<LeadWithStage[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leads")
    .select(
      `id, organization_id, funnel_stage_id, conversation_id, contact_id,
       name, phone, sale_value, last_meta_event, meta_error, created_at, updated_at,
       stage:funnel_stages!inner(id, name, color, meta_event, requires_value, position)`,
    )
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as LeadWithStage[];
}

export async function getLeadByConversation(
  orgId: string,
  conversationId: string,
): Promise<Lead | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leads")
    .select(
      "id, organization_id, funnel_stage_id, conversation_id, contact_id, name, phone, sale_value, last_meta_event, meta_error, created_at, updated_at",
    )
    .eq("organization_id", orgId)
    .eq("conversation_id", conversationId)
    .maybeSingle();
  if (error) throw error;
  return data;
}
