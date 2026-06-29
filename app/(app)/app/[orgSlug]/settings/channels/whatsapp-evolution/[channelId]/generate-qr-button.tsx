"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { generateQrLinkAction } from "@/lib/messaging/adapters/whatsapp-evolution/actions";

export function GenerateQrButton({
  orgSlug,
  channelId,
}: {
  orgSlug: string;
  channelId: string;
}) {
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await generateQrLinkAction({ orgSlug, channelId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      try {
        await navigator.clipboard.writeText(result.data!.url);
        toast.success("Link copiado! Válido por 1 hora. Envie pro cliente para escanear.");
      } catch {
        toast.info(`Link gerado: ${result.data!.url}`);
      }
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={handleClick} disabled={pending}>
      {pending ? "Gerando link..." : "Gerar link para escanear QR"}
    </Button>
  );
}
