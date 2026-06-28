"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  saveMetaIntegrationAction,
  testMetaIntegrationAction,
} from "@/lib/leads/actions";

type Props = {
  orgSlug: string;
  initialPixelId?: string;
  hasToken?: boolean;
};

export function MetaIntegrationForm({ orgSlug, initialPixelId, hasToken }: Props) {
  const [isPending, startTransition] = useTransition();
  const [isTesting, startTest] = useTransition();
  const [pixelId, setPixelId] = useState(initialPixelId ?? "");
  const [token, setToken] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);

  function handleSave() {
    startTransition(async () => {
      const result = await saveMetaIntegrationAction({
        orgSlug,
        pixel_id: pixelId,
        capi_token: token,
      });
      if (!result.ok) {
        toast.error(result.error);
      } else {
        toast.success("Configuração salva!");
        setToken("");
      }
    });
  }

  function handleTest() {
    startTest(async () => {
      setTestResult(null);
      const result = await testMetaIntegrationAction({ orgSlug });
      if (!result.ok) {
        setTestResult(`Erro: ${result.error}`);
      } else {
        setTestResult(result.data?.message ?? "Conexão confirmada!");
      }
    });
  }

  const canSave = !!pixelId && (!!token || !!hasToken);

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-6 max-w-lg">
      <div className="space-y-2">
        <Label htmlFor="pixel-id">Pixel ID</Label>
        <Input
          id="pixel-id"
          value={pixelId}
          onChange={(e) => setPixelId(e.target.value)}
          placeholder="Ex: 1234567890123456"
        />
        <p className="text-xs text-muted-foreground">
          Gerenciador de Eventos → seu Pixel → Configurações
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="capi-token">Token CAPI</Label>
        <Input
          id="capi-token"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={hasToken ? "••••••••••••••• (já configurado)" : "Cole o token aqui"}
        />
        <p className="text-xs text-muted-foreground">
          Gerenciador de Eventos → seu Pixel → Configurações → Conversions API → Gerar token
        </p>
      </div>

      <div className="flex gap-2">
        <Button onClick={handleSave} disabled={isPending || !canSave}>
          {isPending ? "Salvando..." : "Salvar"}
        </Button>

        {hasToken && (
          <Button variant="outline" onClick={handleTest} disabled={isTesting}>
            {isTesting ? "Testando..." : "Testar conexão"}
          </Button>
        )}
      </div>

      {testResult && <p className="text-sm mt-2">{testResult}</p>}
    </div>
  );
}
