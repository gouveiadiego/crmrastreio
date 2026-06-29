import { z } from "zod";

export const createLeadSchema = z.object({
  orgSlug: z.string(),
  conversationId: z.string().uuid().optional(),
  name: z.string().max(200).nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  funnel_stage_id: z.string().uuid(),
});
export type CreateLeadInput = z.infer<typeof createLeadSchema>;

export const moveLeadSchema = z.object({
  orgSlug: z.string(),
  leadId: z.string().uuid(),
  newStageId: z.string().uuid(),
  saleValue: z.number().positive().optional(),
});
export type MoveLeadInput = z.infer<typeof moveLeadSchema>;

export const updateLeadSchema = z.object({
  orgSlug: z.string(),
  leadId: z.string().uuid(),
  name: z.string().max(200).nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
});
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;

export const deleteLeadSchema = z.object({
  orgSlug: z.string(),
  leadId: z.string().uuid(),
});
export type DeleteLeadInput = z.infer<typeof deleteLeadSchema>;

// Schemas de etapas
export const createStageSchema = z.object({
  orgSlug: z.string(),
  name: z.string().min(1).max(80),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#6b7280"),
  meta_event: z.enum(["Lead", "CompleteRegistration", "Schedule", "InitiateCheckout", "Purchase", "LeadLost"]).nullable().optional(),
  requires_value: z.boolean().default(false),
});
export type CreateStageInput = z.infer<typeof createStageSchema>;

export const updateStageSchema = z.object({
  orgSlug: z.string(),
  stageId: z.string().uuid(),
  name: z.string().min(1).max(80).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  meta_event: z.enum(["Lead", "CompleteRegistration", "Schedule", "InitiateCheckout", "Purchase", "LeadLost"]).nullable().optional(),
  requires_value: z.boolean().optional(),
});
export type UpdateStageInput = z.infer<typeof updateStageSchema>;

export const deleteStageSchema = z.object({
  orgSlug: z.string(),
  stageId: z.string().uuid(),
});
export type DeleteStageInput = z.infer<typeof deleteStageSchema>;

export const reorderStagesSchema = z.object({
  orgSlug: z.string(),
  // Array de { id, position } na nova ordem
  stages: z.array(
    z.object({ id: z.string().uuid(), position: z.number().int().min(0) }),
  ),
});
export type ReorderStagesInput = z.infer<typeof reorderStagesSchema>;
