import { createClient } from "@/lib/supabase/server";
import {
  bucketCountsByDay,
  computeCapiHealth,
  computeFunnelConversion,
  computePercentChange,
  sumSaleValues,
  type CapiHealthResult,
  type DateRange,
  type FunnelConversionResult,
  type LeadsCountPoint,
} from "./aggregations";

function previousPeriod(range: DateRange): DateRange {
  const durationMs = range.to.getTime() - range.from.getTime();
  return {
    from: new Date(range.from.getTime() - durationMs),
    to: new Date(range.from.getTime()),
  };
}

export async function getLeadsCountSeries(
  orgId: string,
  range: DateRange,
): Promise<LeadsCountPoint[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leads")
    .select("created_at")
    .eq("organization_id", orgId)
    .gte("created_at", range.from.toISOString())
    .lte("created_at", range.to.toISOString());
  if (error) throw error;
  return bucketCountsByDay((data ?? []).map((r) => r.created_at), range);
}

export async function getLeadsCountComparison(
  orgId: string,
  range: DateRange,
): Promise<{ current: number; previous: number; percentChange: number | null }> {
  const supabase = await createClient();
  const prev = previousPeriod(range);

  const [current, previous] = await Promise.all([
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .gte("created_at", range.from.toISOString())
      .lte("created_at", range.to.toISOString()),
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .gte("created_at", prev.from.toISOString())
      .lte("created_at", prev.to.toISOString()),
  ]);

  if (current.error) throw current.error;
  if (previous.error) throw previous.error;

  const currentCount = current.count ?? 0;
  const previousCount = previous.count ?? 0;
  return {
    current: currentCount,
    previous: previousCount,
    percentChange: computePercentChange(currentCount, previousCount),
  };
}

export async function getFunnelConversion(
  orgId: string,
  range: DateRange,
): Promise<FunnelConversionResult[]> {
  const supabase = await createClient();

  const { data: stages, error: stagesError } = await supabase
    .from("funnel_stages")
    .select("id, name, position")
    .eq("organization_id", orgId)
    .order("position", { ascending: true });
  if (stagesError) throw stagesError;

  const { data: transitions, error: transitionsError } = await supabase
    .from("lead_stage_history")
    .select("to_stage_id")
    .eq("organization_id", orgId)
    .gte("changed_at", range.from.toISOString())
    .lte("changed_at", range.to.toISOString());
  if (transitionsError) throw transitionsError;

  const transitionCounts: Record<string, number> = {};
  for (const row of transitions ?? []) {
    transitionCounts[row.to_stage_id] = (transitionCounts[row.to_stage_id] ?? 0) + 1;
  }

  return computeFunnelConversion(stages ?? [], transitionCounts);
}

export async function getSalesSummary(
  orgId: string,
  range: DateRange,
): Promise<{ count: number; total: number }> {
  const supabase = await createClient();

  const { data: purchaseStages, error: stagesError } = await supabase
    .from("funnel_stages")
    .select("id")
    .eq("organization_id", orgId)
    .eq("meta_event", "Purchase");
  if (stagesError) throw stagesError;

  const purchaseStageIds = (purchaseStages ?? []).map((s) => s.id);
  if (purchaseStageIds.length === 0) return { count: 0, total: 0 };

  const { data: transitions, error: transitionsError } = await supabase
    .from("lead_stage_history")
    .select("lead_id")
    .eq("organization_id", orgId)
    .in("to_stage_id", purchaseStageIds)
    .gte("changed_at", range.from.toISOString())
    .lte("changed_at", range.to.toISOString());
  if (transitionsError) throw transitionsError;

  const leadIds = [...new Set((transitions ?? []).map((t) => t.lead_id))];
  if (leadIds.length === 0) return { count: 0, total: 0 };

  const { data: leads, error: leadsError } = await supabase
    .from("leads")
    .select("sale_value")
    .in("id", leadIds);
  if (leadsError) throw leadsError;

  return {
    count: leadIds.length,
    total: sumSaleValues((leads ?? []).map((l) => l.sale_value)),
  };
}

export async function getCapiHealth(orgId: string, range: DateRange): Promise<CapiHealthResult> {
  const supabase = await createClient();

  const { data: transitions, error: transitionsError } = await supabase
    .from("lead_stage_history")
    .select("lead_id")
    .eq("organization_id", orgId)
    .gte("changed_at", range.from.toISOString())
    .lte("changed_at", range.to.toISOString());
  if (transitionsError) throw transitionsError;

  const leadIds = [...new Set((transitions ?? []).map((t) => t.lead_id))];
  if (leadIds.length === 0) return { success: 0, error: 0 };

  const { data: leads, error: leadsError } = await supabase
    .from("leads")
    .select("meta_error")
    .in("id", leadIds);
  if (leadsError) throw leadsError;

  return computeCapiHealth((leads ?? []).map((l) => l.meta_error));
}
