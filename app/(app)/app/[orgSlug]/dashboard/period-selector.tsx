"use client";

import { useRouter, useSearchParams } from "next/navigation";

const PERIODS = [
  { value: "7", label: "7 dias" },
  { value: "30", label: "30 dias" },
  { value: "90", label: "90 dias" },
] as const;

export function PeriodSelector({ current }: { current: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function selectPeriod(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("period", value);
    router.push(`?${params.toString()}`);
  }

  return (
    <div className="flex items-center gap-1 rounded-full border border-border/60 bg-card/60 p-1">
      {PERIODS.map((p) => (
        <button
          key={p.value}
          type="button"
          onClick={() => selectPeriod(p.value)}
          className={`rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${
            current === p.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
