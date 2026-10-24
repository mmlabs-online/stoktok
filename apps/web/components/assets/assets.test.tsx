import type { Asset } from '../../server/db';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

import { AssetForm } from './asset-form';
import { AssetList } from './asset-list';

const html = (el: React.ReactElement) => renderToStaticMarkup(el);

const cash: Asset = { id: 'a', type: 'cash', name: 'TCBS tiền', value: 5_000_000, asOf: '2026-10-12' };
const other: Asset = { id: 'b', type: 'other', name: 'Vàng', value: 0, asOf: '2026-10-16' };

describe('AssetList', () => {
  it('renders name, type label, formatted value and date in table and cards', () => {
    const out = html(<AssetList assets={[cash, other]} />);
    expect(out).toContain('TCBS tiền');
    expect(out).toContain('Tiền mặt');
    expect(out).toContain('Khác');
    expect(out).toContain('5.000.000');
    expect(out).toContain('12/10/2026');
    expect(out).toContain('md:table');
    expect(out).toContain('md:hidden');
  });
  it('value 0 renders "0 ₫", not a dash', () => {
    const out = html(<AssetList assets={[other]} />);
    expect(out).toContain('0 ₫');
    expect(out).not.toContain('—');
  });
  it('edit and delete links', () => {
    const out = html(<AssetList assets={[cash]} />);
    expect(out).toContain('/assets/a/edit');
    expect(out).toContain('/assets/a/delete');
  });
  it('empty state links to /assets/new', () => {
    const out = html(<AssetList assets={[]} />);
    expect(out).toContain('Chưa có tiền mặt hoặc tài sản khác');
    expect(out).toContain('href="/assets/new"');
  });
});

describe('AssetForm', () => {
  it('shows field errors and keeps typed values', () => {
    const out = html(
      <AssetForm
        action={async (s) => s}
        initial={{
          ok: false,
          fieldErrors: {
            name: { code: 'REQUIRED', message: 'Bắt buộc nhập.' },
            value: { code: 'NOT_INTEGER', message: 'Nhập số nguyên đồng' },
          },
          values: { type: 'other', name: '', value: '1,5', asOf: '2026-10-20' },
        }}
        today="2026-10-23"
        submitLabel="Lưu"
      />,
    );
    expect(out).toContain('Bắt buộc nhập.');
    expect(out).toContain('Nhập số nguyên đồng');
    expect(out).toContain('value="1,5"');
    expect(out).toMatch(/<option value="other" selected="">/);
    expect(out).toContain('max="2026-10-23"');
  });
});
