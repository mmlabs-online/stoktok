import type { ReactNode } from 'react';

export function EmptyState({
  title,
  description,
  icon,
  action,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="bg-surface border-border flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center">
      {icon}
      <p className="font-semibold">{title}</p>
      {description && <p className="text-fg-muted text-sm">{description}</p>}
      {action}
    </div>
  );
}
