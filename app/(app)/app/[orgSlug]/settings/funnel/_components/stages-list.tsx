"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteStageAction } from "@/lib/leads/stages/actions";
import type { FunnelStage } from "@/lib/leads/stages/queries";
import { StageFormDialog } from "./stage-form-dialog";

type Props = {
  stages: FunnelStage[];
  orgSlug: string;
};

export function StagesList({ stages, orgSlug }: Props) {
  const [isPending, startTransition] = useTransition();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editStage, setEditStage] = useState<FunnelStage | undefined>();

  function openCreate() {
    setEditStage(undefined);
    setDialogOpen(true);
  }

  function openEdit(stage: FunnelStage) {
    setEditStage(stage);
    setDialogOpen(true);
  }

  function handleDelete(stage: FunnelStage) {
    if (
      !confirm(
        `Excluir a etapa "${stage.name}"? Leads nessa etapa impedirão a exclusão.`,
      )
    )
      return;
    startTransition(async () => {
      const result = await deleteStageAction({ orgSlug, stageId: stage.id });
      if (!result.ok) toast.error(result.error);
      else toast.success("Etapa excluída.");
    });
  }

  return (
    <>
      <div className="space-y-2">
        {stages.length === 0 && (
          <p className="text-muted-foreground text-sm py-8 text-center border border-dashed border-border rounded-lg">
            Nenhuma etapa criada ainda. Crie a primeira abaixo.
          </p>
        )}

        {stages.map((stage) => (
          <div
            key={stage.id}
            className="flex items-center gap-3 rounded-lg border border-border bg-card p-3"
          >
            <span
              className="w-3 h-3 rounded-full flex-shrink-0"
              style={{ backgroundColor: stage.color }}
            />
            <span className="font-medium text-sm flex-1">{stage.name}</span>
            {stage.meta_event && (
              <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
                {stage.meta_event}
                {stage.requires_value && " 💰"}
              </span>
            )}
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Editar etapa ${stage.name}`}
              onClick={() => openEdit(stage)}
            >
              <PencilIcon className="w-4 h-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Excluir etapa ${stage.name}`}
              className="text-destructive hover:text-destructive"
              onClick={() => handleDelete(stage)}
              disabled={isPending}
            >
              <Trash2Icon className="w-4 h-4" />
            </Button>
          </div>
        ))}

        <Button variant="outline" className="w-full mt-2" onClick={openCreate}>
          <PlusIcon className="w-4 h-4 mr-2" />
          Adicionar etapa
        </Button>
      </div>

      <StageFormDialog
        key={editStage?.id ?? "new"}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        orgSlug={orgSlug}
        stage={editStage}
      />
    </>
  );
}
