import { EmptyState } from "@/components/app/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOrgMember } from "@/lib/auth/guards";
import {
  getCapiHealth,
  getFunnelConversion,
  getLeadsCountComparison,
  getLeadsCountSeries,
  getSalesSummary,
} from "@/lib/dashboard/queries";
import type { DateRange } from "@/lib/dashboard/aggregations";
import { createClient } from "@/lib/supabase/server";
import { CapiHealthCard } from "./capi-health-card";
import { FunnelConversionChart } from "./funnel-conversion-chart";
import { KpiCard } from "./kpi-card";
import { LeadsOverTimeChart } from "./leads-over-time-chart";
import { PeriodSelector } from "./period-selector";

type Props = {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ period?: string }>;
};

export const metadata = { title: "Início" };

const VALID_PERIODS = ["7", "30", "90"] as const;

function resolvePeriod(raw: string | undefined): (typeof VALID_PERIODS)[number] {
  return VALID_PERIODS.includes(raw as (typeof VALID_PERIODS)[number])
    ? (raw as (typeof VALID_PERIODS)[number])
    : "30";
}

function periodRange(days: number): DateRange {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return { from, to };
}

export default async function DashboardPage({ params, searchParams }: Props) {
  const { orgSlug } = await params;
  const { period: rawPeriod } = await searchParams;
  const { user, org } = await requireOrgMember({ orgSlug });

  const period = resolvePeriod(rawPeriod);
  const range = periodRange(Number(period));

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();
  const displayName = profile?.full_name ?? user.email ?? "";

  const [series, comparison, funnel, sales, capiHealth] = await Promise.all([
    getLeadsCountSeries(org.id, range),
    getLeadsCountComparison(org.id, range),
    getFunnelConversion(org.id, range),
    getSalesSummary(org.id, range),
    getCapiHealth(org.id, range),
  ]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1.5">
          <div className="label-mono">/ overview</div>
          <h1 className="font-semibold text-3xl tracking-tight">Bem-vindo, {displayName}</h1>
          <p className="text-muted-foreground text-sm">
            Workspace <span className="text-foreground/80">{org.name}</span>
          </p>
        </div>
        <PeriodSelector current={period} />
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Leads novos"
          value={String(comparison.current)}
          percentChange={comparison.percentChange}
        />
        <KpiCard
          label="Vendas fechadas"
          value={String(sales.count)}
          percentChange={null}
        />
        <KpiCard
          label="Valor total vendido"
          value={sales.total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
          percentChange={null}
        />
        <CapiHealthCard success={capiHealth.success} error={capiHealth.error} />
      </div>

      {/* Chart de evolução */}
      <Card className="overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between border-b border-border/60 bg-card/40 py-3">
          <CardTitle className="flex items-center gap-2 font-medium text-sm">
            <span className="label-mono">/ leads novos</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-5">
          <LeadsOverTimeChart data={series} />
        </CardContent>
      </Card>

      {/* Funil de conversão */}
      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border/60 bg-card/40 py-3">
          <CardTitle className="flex items-center gap-2 font-medium text-sm">
            <span className="label-mono">/ funil de conversão</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-5">
          {funnel.length === 0 ? (
            <EmptyState
              title="Nenhuma etapa configurada"
              description="Configure as etapas do funil em Configurações → Funil para ver o gráfico de conversão."
            />
          ) : (
            <FunnelConversionChart data={funnel} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
