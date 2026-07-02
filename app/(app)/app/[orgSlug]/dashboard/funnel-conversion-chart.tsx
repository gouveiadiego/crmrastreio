"use client";

import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { FunnelConversionResult } from "@/lib/dashboard/aggregations";

const chartConfig = {
  count: { label: "Leads", color: "var(--color-chart-1)" },
} satisfies ChartConfig;

export function FunnelConversionChart({ data }: { data: FunnelConversionResult[] }) {
  const chartData = data.map((stage) => ({
    ...stage,
    displayLabel:
      stage.conversionPct === null ? `${stage.count}` : `${stage.count} (${stage.conversionPct}%)`,
  }));

  return (
    <ChartContainer config={chartConfig} className="h-72 w-full">
      <BarChart
        data={chartData}
        layout="vertical"
        margin={{ top: 12, right: 56, bottom: 0, left: 12 }}
      >
        <CartesianGrid
          strokeDasharray="2 6"
          horizontal={false}
          stroke="currentColor"
          strokeOpacity={0.08}
        />
        <XAxis
          type="number"
          fontSize={10}
          tickLine={false}
          axisLine={false}
          stroke="currentColor"
          opacity={0.5}
          allowDecimals={false}
        />
        <YAxis
          type="category"
          dataKey="name"
          fontSize={10}
          tickLine={false}
          axisLine={false}
          stroke="currentColor"
          opacity={0.5}
          width={110}
        />
        <ChartTooltip
          cursor={{ fill: "var(--color-count)", fillOpacity: 0.08 }}
          content={<ChartTooltipContent indicator="line" />}
        />
        <Bar dataKey="count" fill="var(--color-count)" radius={4}>
          <LabelList dataKey="displayLabel" position="right" fontSize={10} className="fill-foreground" />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
