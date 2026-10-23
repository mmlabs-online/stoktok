import { normalizeSymbol } from '@stoktok/core';
import Link from 'next/link';

export function symbolHref(symbol: string): string | null {
  const s = normalizeSymbol(symbol);
  return s ? `/symbols/${encodeURIComponent(s)}` : null;
}

export function SymbolLink({ symbol, className }: { symbol: string; className?: string }) {
  const href = symbolHref(symbol);
  const base = `font-mono font-bold ${className ?? ''}`.trim();
  if (!href) return <span className={base}>{symbol}</span>;
  return (
    <Link href={href} className={`${base} hover:underline focus-visible:underline`}>
      {normalizeSymbol(symbol)}
    </Link>
  );
}
