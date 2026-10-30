import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SIGNAL_RULE_SECTIONS, appSettingsFromRow, settingsToFormValues } from '@stoktok/core';
import { SettingsForm } from './settings-form';

const values = settingsToFormValues(appSettingsFromRow(null));

const render = (o: Partial<React.ComponentProps<typeof SettingsForm>> = {}) =>
  renderToStaticMarkup(
    <SettingsForm
      action={async (s) => s}
      initial={{ ok: false, fieldErrors: {}, values }}
      feeConfigured={false}
      isDefault
      saved={false}
      concentrationDefault="20"
      {...o}
    />,
  );

describe('SettingsForm', () => {
  it('signal rules card renders every field, label and default', () => {
    const out = render();
    expect(out).toContain('Quy tắc tín hiệu (trung hạn)');
    const fields = SIGNAL_RULE_SECTIONS.flatMap((s) => s.rows.flat());
    expect(fields).toHaveLength(14);
    for (const f of fields) {
      expect(out).toContain(`name="${f.name}"`);
      expect(out).toContain(f.label);
    }
    for (const v of ['"5"', '"20"', '"4"', '"2"', '"10"', '"1"', '"50"', '"200"', '"7"']) expect(out).toContain(`value=${v}`);
    expect(out.match(/type="checkbox"[^>]*checked/g)).toHaveLength(4);
  });

  it('toggle unchecked when value is empty', () => {
    const out = render({ initial: { ok: false, fieldErrors: {}, values: { ...values, peEnabled: '' } } });
    expect(out.match(/type="checkbox"[^>]*checked/g)).toHaveLength(3);
  });

  it('signal field error has aria-invalid and aria-describedby', () => {
    const out = render({
      initial: {
        ok: false,
        fieldErrors: { maLongDays: { code: 'MA_LONG_NOT_ABOVE_SHORT', message: 'MA dài phải lớn hơn MA ngắn.' } },
        values,
      },
    });
    expect(out).toContain('aria-invalid="true"');
    expect(out).toContain('maLongDays-error');
    expect(out).toContain('MA dài phải lớn hơn MA ngắn.');
  });

  it('renders every field', () => {
    const out = render();
    for (const name of [
      'feeRate', 'sellTaxRate', 'priceLimitHOSE', 'priceLimitHNX', 'priceLimitUPCOM',
      'settlementDays', 'lotSize', 'concentrationThreshold',
    ]) {
      expect(out).toContain(`name="${name}"`);
    }
    expect(out.match(/name="cashDividendTreatment"/g)).toHaveLength(2);
    for (const label of [
      'Phí giao dịch (%)', 'Thuế bán (%)', 'Biên độ HOSE (%)', 'Biên độ HNX (%)', 'Biên độ UPCoM (%)',
      'Số ngày thanh toán (T+)', 'Lô giao dịch (cổ phiếu)', 'Ngưỡng cảnh báo tỷ trọng (%)',
    ]) {
      expect(out).toContain(label);
    }
  });

  it('renders default values and banner', () => {
    const out = render();
    for (const v of ['"0,1"', '"7"', '"10"', '"15"', '"2"', '"100"']) expect(out).toContain(`value=${v}`);
    expect(out).toContain('Đang dùng giá trị mặc định');
    expect(out).toContain('Chưa cấu hình');
    expect(out).toContain('placeholder="20"');
  });

  it('renders field errors with aria attributes and the saved banner', () => {
    const out = render({
      saved: true,
      isDefault: false,
      initial: {
        ok: false,
        fieldErrors: { lotSize: { code: 'OUT_OF_RANGE', message: 'Giá trị phải từ 1 đến 10.000.' } },
        values,
      },
    });
    expect(out).toContain('Giá trị phải từ 1 đến 10.000.');
    expect(out).toContain('aria-invalid="true"');
    expect(out).toContain('aria-describedby="lotSize-error"');
    expect(out).toContain('Đã lưu cài đặt.');
    expect(out).not.toContain('Đang dùng giá trị mặc định');
  });
});
