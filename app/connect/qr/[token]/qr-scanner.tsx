"use client";

import { useCallback, useEffect, useState } from "react";

type PageState = "loading" | "qr" | "connected" | "error";

export function QrScanner({ token }: { token: string }) {
  const [pageState, setPageState] = useState<PageState>("loading");
  const [qr, setQr] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchQr = useCallback(async () => {
    try {
      const res = await fetch(`/api/channels/qr?token=${encodeURIComponent(token)}`);
      const data = (await res.json()) as {
        state?: string;
        qr?: string | null;
        error?: string;
      };

      if (!res.ok) {
        setErrorMsg(data.error ?? "Não foi possível carregar o QR code");
        setPageState("error");
        return;
      }

      if (data.state === "connected") {
        setPageState("connected");
        return;
      }

      if (data.qr) {
        setQr(data.qr);
        setPageState("qr");
      } else {
        setPageState("loading");
      }
    } catch {
      setErrorMsg("Sem conexão com o servidor");
      setPageState("error");
    }
  }, [token]);

  useEffect(() => {
    fetchQr();
    const interval = setInterval(fetchQr, 15_000);
    return () => clearInterval(interval);
  }, [fetchQr]);

  if (pageState === "connected") {
    return (
      <div className="flex flex-col items-center gap-6 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-green-500/10 text-4xl">
          ✓
        </div>
        <div className="space-y-2">
          <h1 className="font-bold text-2xl text-green-600">WhatsApp conectado!</h1>
          <p className="text-muted-foreground text-sm">
            Pronto. Pode fechar essa página.
          </p>
        </div>
      </div>
    );
  }

  if (pageState === "error") {
    return (
      <div className="flex flex-col items-center gap-6 text-center">
        <div className="space-y-2">
          <h1 className="font-semibold text-xl">Não foi possível carregar</h1>
          <p className="text-muted-foreground text-sm">{errorMsg}</p>
        </div>
        <button
          type="button"
          onClick={fetchQr}
          className="rounded-md border border-border px-4 py-2 text-sm transition-colors hover:bg-muted"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  if (pageState === "qr" && qr) {
    return (
      <div className="flex flex-col items-center gap-6 text-center">
        <div className="space-y-2">
          <h1 className="font-bold text-2xl">Conectar WhatsApp</h1>
          <p className="text-muted-foreground text-sm max-w-xs">
            Abra o WhatsApp no celular → toque em{" "}
            <strong>Dispositivos vinculados</strong> → <strong>Vincular um dispositivo</strong>
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-white p-3 shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="QR Code WhatsApp" className="h-64 w-64" />
        </div>
        <p className="text-muted-foreground text-xs">
          O código atualiza automaticamente a cada 15 segundos
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      <p className="text-muted-foreground text-sm">Carregando QR code...</p>
    </div>
  );
}
