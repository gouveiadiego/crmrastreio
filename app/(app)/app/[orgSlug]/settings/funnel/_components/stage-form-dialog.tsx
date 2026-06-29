"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createStageAction, updateStageAction } from "@/lib/leads/stages/actions";
import type { FunnelStage } from "@/lib/leads/stages/queries";
import type { CapiEventName } from "@/lib/meta-capi/events";

const META_EVENTS = [
  { value: "Lead", label: "Lead" },
  { value: "CompleteRegistration", label: "CompleteRegistration" },
  { value: "Schedule", label: "Schedule" },
  { value: "InitiateCheckout", label: "InitiateCheckout" },
  { value: "Purchase", label: "Purchase (pede valor de venda)" },
  { value: "LeadLost", label: "LeadLost (custom)" },
];

const COLORS = [
  "#6b7280",
  "#f59e0b",
  "#22c55e",
  "#3b82f6",
  "#8b5cf6",
  "#ef4444",
  "#14b8a6",
  "#f97316",
];

type Props = {
  open: boolean;
  onClose: () => void;
  orgSlug: string;
  stage?: FunnelStage;
};

export function StageFormDialog({ open, onClose, orgSlug, stage }: Props) {
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(stage?.name ?? "");
  const [color, setColor] = useState(stage?.color ?? "#6b7280");
  const [metaEvent, setMetaEvent] = useState<CapiEventName | "">((stage?.meta_event as CapiEventName | null) ?? "");

  const isEdit = !!stage;

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) onClose();
  }

  function handleSubmit() {
    startTransition(async () => {
      const result = isEdit
        ? await updateStageAction({
            orgSlug,
            stageId: stage.id,
            name,
            color,
            meta_event: metaEvent || null,
            requires_value: metaEvent === "Purchase",
          })
        : await createStageAction({
            orgSlug,
            name,
            color,
            meta_event: metaEvent || null,
            requires_value: metaEvent === "Purchase",
          });

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success(isEdit ? "Etapa atualizada!" : "Etapa criada!");
      onClose();
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar etapa" : "Nova etapa"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="stage-name">Nome da etapa</Label>
            <Input
              id="stage-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Qualificado"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label>Cor</Label>
            <div className="flex gap-2 flex-wrap">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Cor ${c}`}
                  className="w-7 h-7 rounded-full border-2 transition-all cursor-pointer"
                  style={{
                    backgroundColor: c,
                    borderColor: color === c ? "white" : "transparent",
                    outline: color === c ? `2px solid ${c}` : "none",
                    outlineOffset: "2px",
                  }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="meta-event">Evento Meta Ads</Label>
            <select
              id="meta-event"
              value={metaEvent}
              onChange={(e) => setMetaEvent(e.target.value as CapiEventName | "")}
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            >
              <option value="">Sem evento (só mover)</option>
              {META_EVENTS.map((ev) => (
                <option key={ev.value} value={ev.value}>
                  {ev.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={isPending || !name.trim()}>
            {isPending ? "Salvando..." : isEdit ? "Salvar" : "Criar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
