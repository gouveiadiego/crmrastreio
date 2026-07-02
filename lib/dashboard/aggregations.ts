export type DateRange = { from: Date; to: Date };
export type LeadsCountPoint = { date: string; count: number };
export type FunnelStageInput = { id: string; name: string; position: number };
export type FunnelConversionResult = {
  stageId: string;
  name: string;
  count: number;
  conversionPct: number | null;
};
export type CapiHealthResult = { success: number; error: number };

export function bucketCountsByDay(timestamps: string[], range: DateRange): LeadsCountPoint[] {
  const counts = new Map<string, number>();
  for (const ts of timestamps) {
    const day = ts.slice(0, 10);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }

  const days: LeadsCountPoint[] = [];
  const cursor = new Date(range.from);
  cursor.setUTCHours(0, 0, 0, 0);
  const end = new Date(range.to);
  end.setUTCHours(0, 0, 0, 0);

  while (cursor.getTime() <= end.getTime()) {
    const day = cursor.toISOString().slice(0, 10);
    days.push({ date: day, count: counts.get(day) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return days;
}

export function computePercentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? null : 100;
  return Math.round(((current - previous) / previous) * 100);
}

export function computeFunnelConversion(
  stages: FunnelStageInput[],
  transitionCounts: Record<string, number>,
): FunnelConversionResult[] {
  const ordered = [...stages].sort((a, b) => a.position - b.position);
  return ordered.map((stage, index) => {
    const count = transitionCounts[stage.id] ?? 0;
    if (index === 0) {
      return { stageId: stage.id, name: stage.name, count, conversionPct: null };
    }
    const previousCount = transitionCounts[ordered[index - 1]!.id] ?? 0;
    const conversionPct = previousCount === 0 ? null : Math.round((count / previousCount) * 100);
    return { stageId: stage.id, name: stage.name, count, conversionPct };
  });
}

export function sumSaleValues(values: (number | null)[]): number {
  return values.reduce((sum: number, v) => sum + (v ?? 0), 0);
}

export function computeCapiHealth(errors: (string | null)[]): CapiHealthResult {
  return errors.reduce(
    (acc, e) => (e ? { success: acc.success, error: acc.error + 1 } : { success: acc.success + 1, error: acc.error }),
    { success: 0, error: 0 },
  );
}
