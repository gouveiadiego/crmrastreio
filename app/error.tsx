"use client";

import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h2 className="font-semibold text-2xl">Algo deu errado</h2>
      <p className="text-muted-foreground text-sm">
        Tente novamente. Se o problema continuar, cole o erro abaixo pro Claude Code e descreva o
        que tava fazendo.
      </p>
      {(error.message || error.digest) && (
        <pre className="max-w-lg overflow-auto rounded-md bg-muted p-3 text-left text-xs text-muted-foreground">
          {error.digest && <span className="block font-bold">digest: {error.digest}</span>}
          {error.message && <span className="block">{error.message}</span>}
        </pre>
      )}
      <Button onClick={reset}>Tentar novamente</Button>
    </div>
  );
}
