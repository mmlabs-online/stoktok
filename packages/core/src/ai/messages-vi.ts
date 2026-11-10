export type AiMessageCode = 'budget_exhausted' | 'budget_warn' | 'provider_unavailable' | 'provider_error' | 'invalid_output';

export type AiMessageParams = Record<string, string | number>;

/** micro-USD to "4,00 USD", rounded up to whole cents. */
export function formatUsdMicro(microUsd: number): string {
  const cents = Math.ceil(microUsd / 10_000);
  const whole = Math.floor(cents / 100);
  return `${whole.toLocaleString('vi-VN')},${String(cents % 100).padStart(2, '0')} USD`;
}

/** Vietnamese message for an AI code. Params: capMicroUsd, spentMicroUsd, percent. */
export function aiMessage(code: AiMessageCode, params: AiMessageParams = {}): string {
  const usd = (k: string) => formatUsdMicro(Number(params[k] ?? 0));
  switch (code) {
    case 'budget_exhausted':
      return `Đã dùng hết ngân sách AI tháng này (${usd('capMicroUsd')}). Các tính năng AI sẽ mở lại vào ngày 1 tháng sau.`;
    case 'budget_warn':
      return `Đã dùng ${String(params.percent ?? 0)}% ngân sách AI tháng này (${usd('spentMicroUsd')} / ${usd('capMicroUsd')}).`;
    case 'provider_unavailable':
      return 'Nhà cung cấp AI chưa được cấu hình hoặc không khả dụng.';
    case 'provider_error':
      return 'Nhà cung cấp AI gặp lỗi. Vui lòng thử lại sau.';
    case 'invalid_output':
      return 'Kết quả AI không hợp lệ nên đã bị loại bỏ.';
  }
}
