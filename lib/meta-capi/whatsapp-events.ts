import { createHash } from "node:crypto";
import { logError } from "@/lib/logger";
import { createServiceClient } from "@/lib/supabase/service";
import { META_GRAPH_VERSION } from "./client";
import { hashField, hashPhone } from "./hash";

export interface WhatsappCapiTracking {
  ctwa_clid?: string | null;
  fbc?: string | null;
  ad_id?: string | null;
  source_url?: string | null;
  em?: string | null;
  client_ip?: string | null;
  client_user_agent?: string | null;
}

export interface FireCapiWhatsappOpts {
  organizationId: string;
  conversationId: string;
  phone: string | null;
  name: string | null;
  tracking: WhatsappCapiTracking | null;
}

export function buildCapiWhatsappPayload(
  eventName: "Lead" | "Contact",
  opts: Omit<FireCapiWhatsappOpts, "organizationId">,
): Record<string, unknown> {
  const { conversationId, phone, name, tracking } = opts;
  const userData: Record<string, unknown> = {};

  const phoneHash = hashPhone(phone);
  if (phoneHash) userData.ph = [phoneHash];

  const firstName = name?.split(" ")[0] ?? null;
  const nameHash = hashField(firstName);
  if (nameHash) userData.fn = [nameHash];

  // external_id: hash SHA-256 do conversationId — identificador estável por conversa
  userData.external_id = [createHash("sha256").update(conversationId).digest("hex")];

  // fbc vai cru — Meta interpreta diretamente, não hashear
  if (tracking?.fbc) userData.fbc = tracking.fbc;

  if (tracking?.em) {
    const emHash = hashField(tracking.em);
    if (emHash) userData.em = [emHash];
  }

  if (tracking?.client_ip) userData.client_ip_address = tracking.client_ip;
  if (tracking?.client_user_agent) userData.client_user_agent = tracking.client_user_agent;

  return {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_id: `wpp_${eventName.toLowerCase()}_${conversationId}`,
    action_source: "system_generated",
    user_data: userData,
  };
}

async function sendWhatsappCapiEvent(
  eventName: "Lead" | "Contact",
  opts: FireCapiWhatsappOpts,
): Promise<void> {
  try {
    const supabase = createServiceClient();
    const { data: integration } = await supabase
      .from("meta_integrations")
      .select("pixel_id, capi_token")
      .eq("organization_id", opts.organizationId)
      .maybeSingle();

    if (!integration) return;

    const payload = buildCapiWhatsappPayload(eventName, opts);
    const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${integration.pixel_id}/events`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: [payload], access_token: integration.capi_token }),
    });

    if (!res.ok) {
      const body = await res.text();
      logError(
        `meta-capi.whatsapp.${eventName.toLowerCase()}`,
        new Error(`HTTP ${res.status}: ${body}`),
      );
    }
  } catch (err) {
    logError(`meta-capi.whatsapp.${eventName.toLowerCase()}`, err);
  }
}

export function fireCapiWhatsappLead(opts: FireCapiWhatsappOpts): Promise<void> {
  return sendWhatsappCapiEvent("Lead", opts);
}

export function fireCapiWhatsappContact(opts: FireCapiWhatsappOpts): Promise<void> {
  return sendWhatsappCapiEvent("Contact", opts);
}
