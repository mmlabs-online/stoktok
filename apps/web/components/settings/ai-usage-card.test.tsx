import { aiBudgetMeter, aiMessage, budgetStatus } from '@stoktok/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AiUsageCard } from './ai-usage-card';

const NOW = new Date('2026-11-15T05:00:00Z');
const render = (spent: number) => {
  const status = budgetStatus(spent);
  return renderToStaticMarkup(<AiUsageCard read={{ ok: true, status }} meter={aiBudgetMeter(status, NOW)} />);
};

describe('AiUsageCard', () => {
  it('ok at 0', () => {
    const out = render(0);
    for (const t of ['Chi phí AI tháng này', '0,00 USD', '5,00 USD', 'Còn lại', 'Trong hạn mức', 'Tháng 11/2026', 'aria-valuenow="0"', 'left:80%']) {
      expect(out).toContain(t);
    }
    expect(out).toContain('role="meter"');
  });
  it('ok at 3_999_999', () => {
    const out = render(3_999_999);
    expect(out).toContain('4,00 USD');
    expect(out).toMatch(/79(<!-- -->)?%/);
    expect(out).toContain('Trong hạn mức');
    expect(out).toContain('data-level="ok"');
    expect(out).not.toContain('data-level="warn"');
  });
  it('warn at 4_000_000', () => {
    const out = render(4_000_000);
    expect(out).toContain(aiMessage('budget_warn', { percent: 80, spentMicroUsd: 4_000_000, capMicroUsd: 5_000_000 }));
    expect(out).toContain('data-level="warn"');
    expect(out).toContain('lucide-triangle-alert');
    expect(out).toContain('aria-valuenow="80"');
  });
  it('exhausted at 5_000_000', () => {
    const out = render(5_000_000);
    expect(out).toContain(aiMessage('budget_exhausted', { capMicroUsd: 5_000_000 }));
    expect(out).toContain('data-level="exhausted"');
    expect(out).toContain('lucide-ban');
  });
  it('over cap at 6_000_000', () => {
    const out = render(6_000_000);
    expect(out).toContain('6,00 USD');
    expect(out).toContain('5,00 USD');
    expect(out).toMatch(/120(<!-- -->)?%/);
    expect(out).toContain('aria-valuenow="100"');
    expect(out).toMatch(/Còn lại <span class="num">0,00 USD/);
  });
  it('error state', () => {
    const out = renderToStaticMarkup(<AiUsageCard read={{ ok: false }} meter={null} />);
    expect(out).toContain('Không tải được chi phí AI tháng này');
    expect(out).toContain('role="status"');
    expect(out).not.toContain('0,00');
    expect(out).not.toContain('role="meter"');
    expect(out).not.toMatch(/pgCode|22023/);
  });
});
