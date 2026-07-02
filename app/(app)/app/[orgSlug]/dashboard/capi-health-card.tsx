import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Props = { success: number; error: number };

export function CapiHealthCard({ success, error }: Props) {
  const total = success + error;
  const errorRate = total === 0 ? 0 : Math.round((error / total) * 100);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-border/60 bg-card/40 py-3">
        <CardTitle className="flex items-center gap-2 font-medium text-sm">
          <span className="label-mono">/ saúde do rastreamento (CAPI)</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-6 p-5">
        <div>
          <div className="label-mono">Enviados com sucesso</div>
          <div className="mt-1 font-semibold text-2xl tabular-nums">{success}</div>
        </div>
        <div>
          <div className="label-mono">Com erro</div>
          <div className="mt-1 font-semibold text-2xl text-destructive tabular-nums">{error}</div>
        </div>
        {total > 0 && (
          <div>
            <div className="label-mono">Taxa de erro</div>
            <div className="mt-1 font-semibold text-2xl tabular-nums">{errorRate}%</div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
