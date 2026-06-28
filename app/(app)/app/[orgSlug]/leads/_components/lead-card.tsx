"use client";

import Link from "next/link";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { LeadWithStage } from "@/lib/leads/queries";

function timeAgo(dateStr: string): string {
  const rtf = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
  const diff = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.round(diff / 1000);
  const minutes = Math.round(seconds / 60);
  const hours = Math.round(minutes / 60);
  const days = Math.round(hours / 24);
  if (days > 0) return rtf.format(-days, "day");
  if (hours > 0) return rtf.format(-hours, "hour");
  if (minutes > 0) return rtf.format(-minutes, "minute");
  return rtf.format(-seconds, "second");
}

type Props = {
  lead: LeadWithStage;
  orgSlug: string;
};

export function LeadCard({ lead, orgSlug }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: lead.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const displayName = lead.name ?? lead.phone ?? "Lead sem nome";
  const ago = timeAgo(lead.created_at);

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="rounded-lg border border-border bg-card p-3 shadow-sm cursor-grab active:cursor-grabbing"
    >
      <p className="font-medium text-sm truncate">{displayName}</p>
      {lead.phone && lead.name && (
        <p className="text-xs text-muted-foreground truncate">{lead.phone}</p>
      )}
      <p className="text-xs text-muted-foreground mt-1">{ago}</p>
      {lead.conversation_id && (
        <Link
          href={`/app/${orgSlug}/inbox/${lead.conversation_id}`}
          className="text-xs text-primary hover:underline mt-1 block"
          onClick={(e) => e.stopPropagation()}
        >
          Ver conversa →
        </Link>
      )}
      {lead.meta_error && (
        <p className="text-xs text-destructive mt-1">⚠ Erro Meta CAPI</p>
      )}
    </div>
  );
}
