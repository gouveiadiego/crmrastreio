import { logError } from "@/lib/logger";
import { createServiceClient } from "@/lib/supabase/service";
import { buildCapiPayload } from "./events";

const META_GRAPH_VERSION = "v19.0";

interface SendCapiEventOpts {
  orgId: string;
  leadId: string;
  stageId: string;
  eventName: string;
  phone: string | null;
  name: string | null;
  value?: number;
}

/**
 * Envia evento para a Meta Conversions API.
 * Lê pixel_id e capi_token da tabela meta_integrations via service client.
 * Se não configurado: retorna silenciosamente (sem erro para o usuário).
 * Se falhar: grava meta_error no lead para exibição na UI.
 * NÃO lança exceção — chamado via after(), nada acima trata.
 */
export async function sendCapiEvent(opts: SendCapiEventOpts): Promise<void> {
  const supabase = createServiceClient();

  const { data: integration } = await supabase
    .from("meta_integrations")
    .select("pixel_id, capi_token")
    .eq("organization_id", opts.orgId)
    .maybeSingle();

  if (!integration) return; // Meta não configurado para esta org

  const payload = buildCapiPayload({
    eventName: opts.eventName,
    leadId: opts.leadId,
    stageId: opts.stageId,
    phone: opts.phone,
    name: opts.name,
    value: opts.value,
  });

  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${integration.pixel_id}/events`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: [payload],
        access_token: integration.capi_token,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      logError("meta-capi.send", new Error(`HTTP ${res.status}: ${body}`));
      await supabase
        .from("leads")
        .update({ meta_error: `HTTP ${res.status}` })
        .eq("id", opts.leadId);
      return;
    }

    // Sucesso — limpa erro anterior e registra evento enviado
    await supabase
      .from("leads")
      .update({ last_meta_event: opts.eventName, meta_error: null })
      .eq("id", opts.leadId);
  } catch (err) {
    logError("meta-capi.send", err);
    await supabase
      .from("leads")
      .update({ meta_error: "Erro de rede ao contatar Meta" })
      .eq("id", opts.leadId);
  }
}
