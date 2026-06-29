import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getJson } from "@/lib/messaging/adapters/whatsapp-evolution/client";
import { verifyQrToken } from "@/lib/messaging/adapters/whatsapp-evolution/qr-token";
import { createServiceClient } from "@/lib/supabase/service";

type EvolutionStateResponse = {
  instance?: { state?: string };
  state?: string;
};

type EvolutionConnectResponse = {
  base64?: string;
  qrcode?: string | { base64?: string };
  instance?: {
    pairingCode?: string | null;
    code?: string | null;
    base64?: string | null;
  };
};

function extractBase64(data: EvolutionConnectResponse): string | null {
  if (typeof data.base64 === "string" && data.base64) return data.base64;
  if (data.instance?.base64) return data.instance.base64;
  if (typeof data.qrcode === "object" && data.qrcode?.base64) return data.qrcode.base64;
  return null;
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Token ausente" }, { status: 400 });
  }

  const payload = verifyQrToken(token);
  if (!payload) {
    return NextResponse.json({ error: "Link inválido ou expirado" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const { data: channel } = await supabase
    .from("channels")
    .select("config")
    .eq("id", payload.channelId)
    .eq("type", "whatsapp_evolution")
    .maybeSingle();

  if (!channel) {
    return NextResponse.json({ error: "Canal não encontrado" }, { status: 404 });
  }

  const cfg = channel.config as { baseUrl: string; apiKey: string; instanceName: string };

  try {
    const stateData = await getJson<EvolutionStateResponse>(
      `${cfg.baseUrl}/instance/connectionState/${cfg.instanceName}`,
      cfg.apiKey,
    );
    const state = stateData.instance?.state ?? stateData.state ?? "unknown";

    if (state === "open") {
      return NextResponse.json({ state: "connected", qr: null });
    }

    const qrData = await getJson<EvolutionConnectResponse>(
      `${cfg.baseUrl}/instance/connect/${cfg.instanceName}`,
      cfg.apiKey,
    );
    const base64 = extractBase64(qrData);

    return NextResponse.json({ state, qr: base64 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
