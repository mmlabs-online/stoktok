import { aiKeyMessage, aiKeyRows } from '@stoktok/core';
import type { AiKeyActionState, AiKeyRow } from '@stoktok/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AiKeyRowView, AiKeysCard } from './ai-keys-card';

const SENTINEL = 'DUMMY-SENTINEL-not-a-real-key';
const noop = async (): Promise<AiKeyActionState> => ({ ok: false, provider: null, code: 'AI_KEY_PROVIDER' });
const UPDATED = '2026-11-10T03:00:00Z';
const meta = [{ provider: 'anthropic', last4: SENTINEL.slice(-4), updatedAt: UPDATED }];
const card = (rows: AiKeyRow[]) => renderToStaticMarkup(<AiKeysCard read={{ ok: true, rows }} saveAction={noop} deleteAction={noop} />);
const none = { anthropic: false, google: false };

const view = (row: AiKeyRow, o: Partial<React.ComponentProps<typeof AiKeyRowView>> = {}) =>
  renderToStaticMarkup(
    <AiKeyRowView
      row={row}
      saveState={null}
      deleteState={null}
      confirming={false}
      savePending={false}
      deletePending={false}
      onSaveAction={() => {}}
      onDeleteAction={() => {}}
      onAskDelete={() => {}}
      onCancelDelete={() => {}}
      {...o}
    />,
  );

describe('AiKeysCard', () => {
  it('title, note, one row per provider in order, section not a form', () => {
    const out = card(aiKeyRows([], none));
    expect(out).toContain('<section');
    expect(out).toContain('aria-labelledby="ai-keys-title"');
    expect(out).toContain('Khóa AI');
    expect(out).toContain('không bao giờ hiển thị lại');
    expect(out.indexOf('Anthropic')).toBeGreaterThan(-1);
    expect(out.indexOf('Anthropic')).toBeLessThan(out.indexOf('Google AI'));
    expect(out.match(/<form/g)).toHaveLength(2);
    expect(out.startsWith('<section')).toBe(true);
  });
  it('read failure shows a message and no controls', () => {
    const out = renderToStaticMarkup(<AiKeysCard read={{ ok: false }} saveAction={noop} deleteAction={noop} />);
    expect(out).toContain('Không đọc được trạng thái khóa AI');
    expect(out).not.toContain('<input');
    expect(out).not.toContain('<button');
  });
  it('none row', () => {
    const out = view(aiKeyRows([], none)[0]!);
    expect(out).toContain('Chưa có khóa — AI tắt');
    expect(out).toContain('Lưu khóa');
    expect(out).not.toContain('Xóa');
  });
  it('ui row shows last4 and date, delete is a plain button', () => {
    const out = view(aiKeyRows(meta, none)[0]!);
    expect(out).toContain('••••');
    expect(out).toContain(SENTINEL.slice(-4));
    expect(out).toContain('lưu ngày 10/11/2026');
    expect(out).toContain('Thay khóa');
    expect(out).toMatch(/<button type="button"[^>]*aria-label="Xóa khóa Anthropic"/);
  });
  it('ui row with env fallback', () => {
    expect(view(aiKeyRows(meta, { anthropic: true, google: false })[0]!)).toContain('được ưu tiên hơn khóa trên máy chủ');
  });
  it('env row: presence only', () => {
    const out = view(aiKeyRows([], { anthropic: true, google: false })[0]!);
    expect(out).toContain('Đang dùng khóa trên máy chủ');
    expect(out).toContain('không xóa tại đây');
    expect(out).not.toContain('••••');
    expect(out).not.toContain('>Xóa<');
  });
  it('password input attributes', () => {
    const out = view(aiKeyRows([], none)[0]!);
    for (const a of ['type="password"', 'autoComplete="off"', 'autoCapitalize="off"', 'spellCheck="false"', 'data-1p-ignore=""', 'data-lpignore="true"', 'data-bwignore=""']) {
      expect(out.toLowerCase()).toContain(a.toLowerCase());
    }
    expect(out).toContain('for="ai-key-anthropic"');
    expect(out).toContain('name="provider"');
    const input = out.match(/<input[^>]*name="key"[^>]*>/)![0];
    expect(input).not.toContain('value=');
  });
  it('input has no value after error and success; fixed messages shown', () => {
    const row = aiKeyRows([], none)[0]!;
    const err = view(row, { saveState: { ok: false, provider: 'anthropic', code: 'AI_KEY_LENGTH' } });
    expect(err).toContain('role="alert"');
    expect(err).toContain(aiKeyMessage('AI_KEY_LENGTH', 'save'));
    const ok = view(row, { saveState: { ok: true, provider: 'anthropic', last4: 'abcd', savedAt: UPDATED } });
    expect(ok).toContain('role="status"');
    expect(ok).toContain('Đã lưu khóa Anthropic');
    for (const out of [err, ok]) expect(out.match(/<input[^>]*name="key"[^>]*>/)![0]).not.toContain('value=');
  });
  it('delete needs confirmation', () => {
    const row = aiKeyRows(meta, none)[0]!;
    const closed = view(row);
    expect(closed).not.toContain('ai-key-delete-form-anthropic');
    expect(closed).not.toContain('type="submit" aria-label');
    const open = view(row, { confirming: true });
    expect(open).toContain('data-testid="ai-key-delete-form-anthropic"');
    expect(open).toContain('aria-label="Xác nhận xóa khóa Anthropic"');
    expect(open).toContain('type="submit"');
    expect(open).toContain('Hủy');
    expect(open).toContain('AI dùng Anthropic sẽ tắt.');
    expect(view(aiKeyRows(meta, { anthropic: true, google: false })[0]!, { confirming: true })).toContain('quay về khóa trên máy chủ');
  });
  it('the sentinel never appears in HTML', () => {
    const rows = aiKeyRows(meta, none);
    const outs = [
      card(rows),
      view(rows[0]!, { saveState: { ok: false, provider: 'anthropic', code: 'AI_KEY_DB_ERROR' } }),
      view(rows[0]!, { saveState: { ok: true, provider: 'anthropic', last4: 'abcd', savedAt: UPDATED } }),
      view(rows[0]!, { deleteState: { ok: true, provider: 'anthropic', deleted: true }, confirming: true }),
    ];
    for (const out of outs) expect(out).not.toContain(SENTINEL);
  });
});
