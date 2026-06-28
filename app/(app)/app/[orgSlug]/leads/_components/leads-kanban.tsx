"use client";

import { useState, useTransition } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { FunnelStage } from "@/lib/leads/stages/queries";
import type { LeadWithStage } from "@/lib/leads/queries";
import { moveLeadAction } from "@/lib/leads/actions";
import { LeadCard } from "./lead-card";
import { MoveLeadDialog } from "./move-lead-dialog";

type Props = {
  stages: FunnelStage[];
  leads: LeadWithStage[];
  orgSlug: string;
};

type DroppableColumnProps = {
  stage: FunnelStage;
  leads: LeadWithStage[];
  orgSlug: string;
};

function DroppableColumn({ stage, leads, orgSlug }: DroppableColumnProps) {
  const { setNodeRef } = useDroppable({ id: stage.id });
  return (
    <div className="flex flex-col gap-2 min-w-[260px] max-w-[260px]">
      <div className="flex items-center gap-2 mb-1">
        <span
          className="w-3 h-3 rounded-full flex-shrink-0"
          style={{ backgroundColor: stage.color }}
        />
        <span className="font-medium text-sm uppercase tracking-wide text-muted-foreground">
          {stage.name}
        </span>
        <span className="ml-auto text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
          {leads.length}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className="flex flex-col gap-2 flex-1 min-h-[120px] rounded-lg border-2 border-dashed border-border/50 p-2"
      >
        <SortableContext items={leads.map((l) => l.id)} strategy={verticalListSortingStrategy}>
          {leads.map((lead) => (
            <LeadCard key={lead.id} lead={lead} orgSlug={orgSlug} />
          ))}
        </SortableContext>
      </div>
    </div>
  );
}

type PendingMove = {
  leadId: string;
  newStageId: string;
  stageName: string;
};

export function LeadsKanban({ stages, leads, orgSlug }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [activeLeadId, setActiveLeadId] = useState<string | null>(null);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const leadsByStage = stages.reduce<Record<string, LeadWithStage[]>>((acc, stage) => {
    acc[stage.id] = leads.filter((l) => l.funnel_stage_id === stage.id);
    return acc;
  }, {});

  const activeLead = activeLeadId ? leads.find((l) => l.id === activeLeadId) ?? null : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveLeadId(event.active.id as string);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveLeadId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const lead = leads.find((l) => l.id === active.id);
    if (!lead) return;

    // Resolve target stage — over.id can be a stage id or another lead id
    const targetStageId =
      stages.find((s) => s.id === (over.id as string))?.id ??
      leads.find((l) => l.id === (over.id as string))?.funnel_stage_id;

    if (!targetStageId || targetStageId === lead.funnel_stage_id) return;

    const targetStage = stages.find((s) => s.id === targetStageId);
    if (!targetStage) return;

    if (targetStage.requires_value) {
      setPendingMove({ leadId: lead.id, newStageId: targetStageId, stageName: targetStage.name });
      return;
    }

    doMove(lead.id, targetStageId);
  }

  function doMove(leadId: string, newStageId: string, saleValue?: number) {
    startTransition(async () => {
      const result = await moveLeadAction({ orgSlug, leadId, newStageId, saleValue });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <>
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex gap-4 overflow-x-auto p-6 flex-1 min-h-0">
          {stages.map((stage) => (
            <DroppableColumn
              key={stage.id}
              stage={stage}
              leads={leadsByStage[stage.id] ?? []}
              orgSlug={orgSlug}
            />
          ))}
        </div>
        <DragOverlay>
          {activeLead ? <LeadCard lead={activeLead} orgSlug={orgSlug} isDragOverlay={true} /> : null}
        </DragOverlay>
      </DndContext>

      {pendingMove && (
        <MoveLeadDialog
          open={!!pendingMove}
          stageName={pendingMove.stageName}
          onConfirm={(value) => {
            doMove(pendingMove.leadId, pendingMove.newStageId, value);
            setPendingMove(null);
          }}
          onCancel={() => setPendingMove(null)}
        />
      )}
    </>
  );
}
