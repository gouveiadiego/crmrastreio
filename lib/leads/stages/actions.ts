"use server";

import { revalidatePath } from "next/cache";
import { requireOrgRole } from "@/lib/auth/guards";
import { logError } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import type { TablesUpdate } from "@/types/supabase";
import {
  type CreateStageInput,
  createStageSchema,
  type DeleteStageInput,
  deleteStageSchema,
  type ReorderStagesInput,
  reorderStagesSchema,
  type UpdateStageInput,
  updateStageSchema,
} from "../schemas";

type ActionResult<T = void> = { ok: true; data?: T } | { ok: false; error: string };

export async function createStageAction(
  input: CreateStageInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = createStageSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };

  const { org } = await requireOrgRole({ orgSlug: parsed.data.orgSlug, roles: ["owner", "admin"] });
  const supabase = await createClient();

  // Próxima posição = máximo + 1
  const { data: last } = await supabase
    .from("funnel_stages")
    .select("position")
    .eq("organization_id", org.id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextPosition = (last?.position ?? -1) + 1;

  const { data, error } = await supabase
    .from("funnel_stages")
    .insert({
      organization_id: org.id,
      name: parsed.data.name,
      color: parsed.data.color,
      meta_event: parsed.data.meta_event ?? null,
      requires_value: parsed.data.requires_value,
      position: nextPosition,
    })
    .select("id")
    .single();

  if (error || !data) {
    logError("leads.stages.create", error);
    return { ok: false, error: "Erro ao criar etapa. Tente novamente." };
  }

  revalidatePath(`/app/${parsed.data.orgSlug}/leads`);
  revalidatePath(`/app/${parsed.data.orgSlug}/settings/funnel`);
  return { ok: true, data: { id: data.id } };
}

export async function updateStageAction(input: UpdateStageInput): Promise<ActionResult> {
  const parsed = updateStageSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };

  const { org } = await requireOrgRole({ orgSlug: parsed.data.orgSlug, roles: ["owner", "admin"] });
  const supabase = await createClient();

  const patch: TablesUpdate<"funnel_stages"> = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.color !== undefined) patch.color = parsed.data.color;
  if (parsed.data.meta_event !== undefined) patch.meta_event = parsed.data.meta_event;
  if (parsed.data.requires_value !== undefined) patch.requires_value = parsed.data.requires_value;

  const { error } = await supabase
    .from("funnel_stages")
    .update(patch)
    .eq("id", parsed.data.stageId)
    .eq("organization_id", org.id);

  if (error) {
    logError("leads.stages.update", error);
    return { ok: false, error: "Erro ao atualizar etapa. Tente novamente." };
  }

  revalidatePath(`/app/${parsed.data.orgSlug}/leads`);
  revalidatePath(`/app/${parsed.data.orgSlug}/settings/funnel`);
  return { ok: true };
}

export async function deleteStageAction(input: DeleteStageInput): Promise<ActionResult> {
  const parsed = deleteStageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos" };

  const { org } = await requireOrgRole({ orgSlug: parsed.data.orgSlug, roles: ["owner", "admin"] });
  const supabase = await createClient();

  // Bloqueia exclusão de etapa de sistema
  const { data: stage } = await supabase
    .from("funnel_stages")
    .select("is_system")
    .eq("id", parsed.data.stageId)
    .eq("organization_id", org.id)
    .maybeSingle();

  if (!stage) {
    return { ok: false, error: "Etapa não encontrada." };
  }

  if (stage.is_system) {
    return { ok: false, error: "Etapa padrão do sistema — não pode ser excluída." };
  }

  // Bloqueia se há leads nessa etapa
  const { count } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("funnel_stage_id", parsed.data.stageId)
    .eq("organization_id", org.id);

  if (count && count > 0) {
    return {
      ok: false,
      error: `Essa etapa tem ${count} lead(s). Mova-os antes de excluir.`,
    };
  }

  const { error } = await supabase
    .from("funnel_stages")
    .delete()
    .eq("id", parsed.data.stageId)
    .eq("organization_id", org.id);

  if (error) {
    logError("leads.stages.delete", error);
    return { ok: false, error: "Erro ao excluir etapa. Tente novamente." };
  }

  revalidatePath(`/app/${parsed.data.orgSlug}/leads`);
  revalidatePath(`/app/${parsed.data.orgSlug}/settings/funnel`);
  return { ok: true };
}

export async function reorderStagesAction(input: ReorderStagesInput): Promise<ActionResult> {
  const parsed = reorderStagesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos" };

  const { org } = await requireOrgRole({ orgSlug: parsed.data.orgSlug, roles: ["owner", "admin"] });
  const supabase = await createClient();

  // Atualiza position de cada etapa em paralelo
  const updates = parsed.data.stages.map(({ id, position }) =>
    supabase
      .from("funnel_stages")
      .update({ position })
      .eq("id", id)
      .eq("organization_id", org.id),
  );

  const results = await Promise.all(updates);
  const failed = results.find((r) => r.error);
  if (failed?.error) {
    logError("leads.stages.reorder", failed.error);
    return { ok: false, error: "Erro ao reordenar etapas. Tente novamente." };
  }

  revalidatePath(`/app/${parsed.data.orgSlug}/leads`);
  revalidatePath(`/app/${parsed.data.orgSlug}/settings/funnel`);
  return { ok: true };
}
