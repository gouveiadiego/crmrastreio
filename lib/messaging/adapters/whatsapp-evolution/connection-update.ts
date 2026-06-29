import { logError } from "@/lib/logger";
import { createServiceClient } from "@/lib/supabase/service";

type EvolutionState = "open" | "close" | "connecting" | string;

export async function handleConnectionUpdate(
  instanceName: string,
  state: EvolutionState,
  ownerJid?: string | null,
): Promise<void> {
  if (!instanceName) return;
  const supabase = createServiceClient();
  let newStatus: "connected" | "error" | "pending" | "disconnected";
  let lastError: string | null = null;
  if (state === "open") {
    newStatus = "connected";
  } else if (state === "close") {
    newStatus = "error";
    lastError = "Instância desconectou no Evolution. Use o botão 'Gerar link para escanear QR' para reconectar.";
  } else if (state === "connecting") {
    newStatus = "pending";
  } else {
    newStatus = "disconnected";
  }

  const { error } = await supabase
    .from("channels")
    .update({ status: newStatus, last_error: lastError })
    .eq("type", "whatsapp_evolution")
    .eq("external_id", instanceName);
  if (error) logError("evolution.connection-update", error);

  // Quando conecta, salva o número na config (se vier no payload do webhook).
  if (state === "open" && ownerJid) {
    const { data: channel } = await supabase
      .from("channels")
      .select("config")
      .eq("type", "whatsapp_evolution")
      .eq("external_id", instanceName)
      .maybeSingle();
    if (channel) {
      const { error: cfgError } = await supabase
        .from("channels")
        .update({ config: { ...(channel.config as object), connectedNumber: ownerJid } })
        .eq("type", "whatsapp_evolution")
        .eq("external_id", instanceName);
      if (cfgError) logError("evolution.connection-update.config", cfgError);
    }
  }
}
