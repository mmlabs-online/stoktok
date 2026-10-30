import type { EntryError } from '../entry/messages-vi';
import { formatRatePercentInput } from '../entry/parse-input';
import { SIGNAL_RULE_BOUNDS } from '../signals/config';
import type { SignalRules, ValuationRuleParams } from '../signals/config';
import { readInteger, readPercent } from './read-fields';

/** Raw strings of the medium-term signal rules on the settings form. Toggles are 'on' (checked) or ''. */
export interface SignalRulesFormRaw {
  peEnabled: string;
  peMinPeers: string;
  peDiscount: string;
  pePremium: string;
  pbEnabled: string;
  pbMinPeers: string;
  pbDiscount: string;
  pbPremium: string;
  growthEnabled: string;
  growthComparisons: string;
  growthMinConsecutive: string;
  growthThreshold: string;
  growthMinBase: string;
  maEnabled: string;
  maShortDays: string;
  maLongDays: string;
  maNeutralBand: string;
  financialsMaxFetchAgeDays: string;
}

export type SignalRulesField = keyof SignalRulesFormRaw;

export interface SignalRuleFieldSpec {
  name: SignalRulesField;
  label: string;
  help?: string;
  mode: 'numeric' | 'decimal';
}

export interface SignalRuleSection {
  key: keyof SignalRules;
  legend: string;
  enabledField?: SignalRulesField;
  note?: string;
  /** Fields grouped in display rows; a row with two fields is shown side by side. */
  rows: SignalRuleFieldSpec[][];
}

export const SIGNAL_RULE_CARD_TITLE = 'Quy tắc tín hiệu (trung hạn)';
export const SIGNAL_RULE_CARD_NOTE =
  'Tham số của tín hiệu trung hạn (1–6 tháng). Tín hiệu chỉ cho biết chiều hướng, không phải khuyến nghị.';

function valuationSection(
  key: 'peVsSector' | 'pbVsSector',
  ratio: 'P/E' | 'P/B',
  f: { enabled: SignalRulesField; minPeers: SignalRulesField; discount: SignalRulesField; premium: SignalRulesField },
  note?: string,
): SignalRuleSection {
  return {
    key,
    legend: `${ratio} so với ngành`,
    enabledField: f.enabled,
    note,
    rows: [
      [
        {
          name: f.minPeers,
          label: 'Số mã cùng ngành tối thiểu (mã)',
          help: 'Chỉ tính các mã trong danh sách theo dõi và danh mục. Dưới mức này tín hiệu bị ẩn.',
          mode: 'numeric',
        },
      ],
      [
        { name: f.discount, label: 'Ngưỡng thấp hơn trung vị ngành (%)', mode: 'decimal' },
        { name: f.premium, label: 'Ngưỡng cao hơn trung vị ngành (%)', mode: 'decimal' },
      ],
    ],
  };
}

export const SIGNAL_RULE_SECTIONS: SignalRuleSection[] = [
  valuationSection(
    'peVsSector',
    'P/E',
    { enabled: 'peEnabled', minPeers: 'peMinPeers', discount: 'peDiscount', premium: 'pePremium' },
    'P/E bị ẩn cho đến khi xác minh cơ sở EPS của nguồn dữ liệu.',
  ),
  valuationSection('pbVsSector', 'P/B', {
    enabled: 'pbEnabled',
    minPeers: 'pbMinPeers',
    discount: 'pbDiscount',
    premium: 'pbPremium',
  }),
  {
    key: 'earningsGrowth',
    legend: 'Tăng trưởng lợi nhuận',
    enabledField: 'growthEnabled',
    rows: [
      [
        { name: 'growthComparisons', label: 'Số quý so sánh (quý)', help: 'So sánh cùng kỳ năm trước.', mode: 'numeric' },
        {
          name: 'growthMinConsecutive',
          label: 'Số quý liên tiếp tối thiểu (quý)',
          help: 'Không vượt quá số quý so sánh.',
          mode: 'numeric',
        },
      ],
      [
        { name: 'growthThreshold', label: 'Ngưỡng tăng trưởng (%)', mode: 'decimal' },
        {
          name: 'growthMinBase',
          label: 'Nền lợi nhuận tối thiểu (% doanh thu)',
          help: 'Nền thấp hơn mức này chỉ cho biết chiều hướng, không tính %.',
          mode: 'decimal',
        },
      ],
    ],
  },
  {
    key: 'priceVsMa',
    legend: 'Giá so với đường MA',
    enabledField: 'maEnabled',
    rows: [
      [
        { name: 'maShortDays', label: 'MA ngắn (phiên)', mode: 'numeric' },
        {
          name: 'maLongDays',
          label: 'MA dài (phiên)',
          help: 'MA ngắn phải nhỏ hơn MA dài. Đổi số phiên sẽ bắt đầu chuỗi tín hiệu mới.',
          mode: 'numeric',
        },
      ],
      [{ name: 'maNeutralBand', label: 'Biên trung tính quanh MA (%)', mode: 'decimal' }],
    ],
  },
  {
    key: 'freshness',
    legend: 'Độ mới của dữ liệu tài chính',
    rows: [
      [
        {
          name: 'financialsMaxFetchAgeDays',
          label: 'Tuổi tối đa của dữ liệu tài chính (ngày)',
          help: 'Tăng giá trị này nới lỏng kiểm tra dữ liệu cũ.',
          mode: 'numeric',
        },
      ],
    ],
  },
];

const B = SIGNAL_RULE_BOUNDS;

export type ValidateSignalRulesResult =
  | { ok: true; value: SignalRules }
  | { ok: false; errors: Partial<Record<SignalRulesField, EntryError>> };

export function validateSignalRulesInput(raw: SignalRulesFormRaw): ValidateSignalRulesResult {
  const errors: Partial<Record<SignalRulesField, EntryError>> = {};
  const values: Partial<Record<SignalRulesField, number>> = {};

  const pct = (name: SignalRulesField, b: { min: number; max: number }) => {
    const r = readPercent(raw[name], b, 'required');
    if ('error' in r) errors[name] = r.error;
    else values[name] = r.value as number;
  };
  const int = (name: SignalRulesField, b: { min: number; max: number }) => {
    const r = readInteger(raw[name], b);
    if ('error' in r) errors[name] = r.error;
    else values[name] = r.value;
  };

  int('peMinPeers', B.minPeers);
  pct('peDiscount', B.ratioPpm);
  pct('pePremium', B.ratioPpm);
  int('pbMinPeers', B.minPeers);
  pct('pbDiscount', B.ratioPpm);
  pct('pbPremium', B.ratioPpm);
  int('growthComparisons', B.comparisons);
  int('growthMinConsecutive', { min: 1, max: B.comparisons.max });
  pct('growthThreshold', B.ratioPpm);
  pct('growthMinBase', B.ratioPpm);
  int('maShortDays', B.maDays);
  int('maLongDays', B.maDays);
  pct('maNeutralBand', B.neutralBandPpm);
  int('financialsMaxFetchAgeDays', B.maxFetchAgeDays);

  const v = values as Record<SignalRulesField, number>;
  if (v.growthMinConsecutive !== undefined && v.growthComparisons !== undefined && v.growthMinConsecutive > v.growthComparisons) {
    errors.growthMinConsecutive = { code: 'MIN_CONSECUTIVE_ABOVE_COMPARISONS' };
  }
  if (v.maShortDays !== undefined && v.maLongDays !== undefined && v.maShortDays >= v.maLongDays) {
    errors.maLongDays = { code: 'MA_LONG_NOT_ABOVE_SHORT' };
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const on = (s: string) => s === 'on';
  const valuation = (enabled: string, p: 'pe' | 'pb'): ValuationRuleParams => ({
    enabled: on(enabled),
    minPeers: v[`${p}MinPeers`],
    discountPpm: v[`${p}Discount`],
    premiumPpm: v[`${p}Premium`],
  });
  return {
    ok: true,
    value: {
      peVsSector: valuation(raw.peEnabled, 'pe'),
      pbVsSector: valuation(raw.pbEnabled, 'pb'),
      earningsGrowth: {
        enabled: on(raw.growthEnabled),
        comparisons: v.growthComparisons,
        minConsecutive: v.growthMinConsecutive,
        growthThresholdPpm: v.growthThreshold,
        minBasePpmOfRevenue: v.growthMinBase,
      },
      priceVsMa: {
        enabled: on(raw.maEnabled),
        shortDays: v.maShortDays,
        longDays: v.maLongDays,
        neutralBandPpm: v.maNeutralBand,
      },
      freshness: { financialsMaxFetchAgeDays: v.financialsMaxFetchAgeDays },
    },
  };
}

export function signalRulesToFormValues(r: SignalRules): SignalRulesFormRaw {
  const pct = formatRatePercentInput;
  const toggle = (b: boolean) => (b ? 'on' : '');
  return {
    peEnabled: toggle(r.peVsSector.enabled),
    peMinPeers: String(r.peVsSector.minPeers),
    peDiscount: pct(r.peVsSector.discountPpm),
    pePremium: pct(r.peVsSector.premiumPpm),
    pbEnabled: toggle(r.pbVsSector.enabled),
    pbMinPeers: String(r.pbVsSector.minPeers),
    pbDiscount: pct(r.pbVsSector.discountPpm),
    pbPremium: pct(r.pbVsSector.premiumPpm),
    growthEnabled: toggle(r.earningsGrowth.enabled),
    growthComparisons: String(r.earningsGrowth.comparisons),
    growthMinConsecutive: String(r.earningsGrowth.minConsecutive),
    growthThreshold: pct(r.earningsGrowth.growthThresholdPpm),
    growthMinBase: pct(r.earningsGrowth.minBasePpmOfRevenue),
    maEnabled: toggle(r.priceVsMa.enabled),
    maShortDays: String(r.priceVsMa.shortDays),
    maLongDays: String(r.priceVsMa.longDays),
    maNeutralBand: pct(r.priceVsMa.neutralBandPpm),
    financialsMaxFetchAgeDays: String(r.freshness.financialsMaxFetchAgeDays),
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Writes signals.medium into existing rule_configs, keeping market, other horizons and unknown keys. */
export function mergeSignalRules(existing: unknown, rules: SignalRules): Record<string, unknown> {
  const base = isObject(existing) ? existing : {};
  const signals = isObject(base.signals) ? base.signals : {};
  const medium = isObject(signals.medium) ? signals.medium : {};
  const sub = (key: keyof SignalRules, values: object) => ({ ...(isObject(medium[key]) ? (medium[key] as object) : {}), ...values });
  return {
    ...base,
    signals: {
      ...signals,
      medium: {
        ...medium,
        peVsSector: sub('peVsSector', rules.peVsSector),
        pbVsSector: sub('pbVsSector', rules.pbVsSector),
        earningsGrowth: sub('earningsGrowth', rules.earningsGrowth),
        priceVsMa: sub('priceVsMa', rules.priceVsMa),
        freshness: sub('freshness', rules.freshness),
      },
    },
  };
}
