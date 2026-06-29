import { hashField, hashPhone } from "./hash";

export const CAPI_EVENT_NAMES = [
  "Lead",
  "CompleteRegistration",
  "Schedule",
  "InitiateCheckout",
  "Purchase",
  "LeadLost",
] as const;

export type CapiEventName = (typeof CAPI_EVENT_NAMES)[number];

interface BuildCapiPayloadOpts {
  eventName: string;
  leadId: string;
  stageId: string;
  phone: string | null;
  name: string | null;
  value?: number;
}

/**
 * Monta o payload de um evento para a Meta Conversions API.
 * Telefone e nome são hasheados com SHA-256 antes de sair.
 */
export function buildCapiPayload(opts: BuildCapiPayloadOpts): object {
  const { eventName, leadId, stageId, phone, name, value } = opts;

  const userData: Record<string, string[]> = {};
  const phoneHash = hashPhone(phone);
  if (phoneHash) userData.ph = [phoneHash];
  const firstName = name?.split(" ")[0] ?? null;
  const nameHash = hashField(firstName);
  if (nameHash) userData.fn = [nameHash];

  const customData: Record<string, unknown> = {};
  if (value !== undefined && value > 0) {
    customData.value = value;
    customData.currency = "BRL";
  }

  return {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    // event_id com janela de 1 hora — dedup contra duplo-clique acidental,
    // mas permite re-conversão legítima após 1h (sem bloquear venda real)
    event_id: `lead_${leadId}_stage_${stageId}_${Math.floor(Date.now() / 3_600_000)}`,
    action_source: "system_generated",
    user_data: userData,
    ...(Object.keys(customData).length > 0 ? { custom_data: customData } : {}),
  };
}
