import type { ReactNode } from 'react';

export function StatCard({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <dl className="bg-surface border-border shadow-card rounded-lg border p-4">
      <dt className="text-fg-muted flex items-center gap-2 text-sm">
        {icon}
        {label}
      </dt>
      <dd className="num mt-1 text-2xl font-semibold">{value}</dd>
      {sub && <dd className="text-fg-muted mt-1 text-sm">{sub}</dd>}
    </dl>
  );
}
