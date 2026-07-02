import { ArrowDownIcon, ArrowUpIcon, MinusIcon } from "lucide-react";

type Props = {
  label: string;
  value: string;
  percentChange: number | null;
};

export function KpiCard({ label, value, percentChange }: Props) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-border bg-card glow-hover surface-highlight">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/0 to-transparent transition-all group-hover:via-primary/60" />

      <div className="p-5">
        <div className="flex items-start justify-between">
          <span className="label-mono">{label}</span>
          {percentChange !== null && (
            <div
              className={`flex items-center gap-0.5 font-mono text-[10px] tracking-wide ${
                percentChange >= 0 ? "text-primary" : "text-destructive"
              }`}
            >
              {percentChange === 0 ? (
                <MinusIcon className="h-3 w-3" />
              ) : percentChange > 0 ? (
                <ArrowUpIcon className="h-3 w-3" />
              ) : (
                <ArrowDownIcon className="h-3 w-3" />
              )}
              {percentChange > 0 ? "+" : ""}
              {percentChange}%
            </div>
          )}
        </div>

        <div className="mt-3 font-semibold text-3xl tracking-tight tabular-nums">{value}</div>
      </div>
    </div>
  );
}
