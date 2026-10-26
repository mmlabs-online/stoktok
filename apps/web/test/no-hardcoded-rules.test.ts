import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const webRoot = path.resolve(__dirname, '..');
const DIRS = [
  ...['app', 'components', 'server', 'lib'].map((d) => path.join(webRoot, d)),
  path.resolve(__dirname, '../../worker/src'),
];

// DEFAULT_PRICE_CUTOFF_MINUTES_VN and DEFAULT_PRICE_SANITY are deliberately not forbidden: they are
// not settings in the STK-010 form (follow-up F4).
const ALLOWLIST: { file: string; pattern: RegExp; reason: string }[] = [];

const IDENTIFIERS = [
  /\bDEFAULT_TRADING_RULES\b/,
  /\bDEFAULT_MARKET_SETTINGS\b/,
  /\bDEFAULT_MARKET_RULES\b/,
  /\bDEFAULT_CONCENTRATION_THRESHOLD_PPM\b/,
];
const LITERALS = [
  /lotSize\s*[:=]\s*\d/,
  /settlementDays\s*[:=]\s*\d/,
  /(Rate|Threshold)Ppm\s*[:=]\s*\d/,
  /\b(HOSE|HNX|UPCOM|UPCoM)\b['"]?\s*[:=]\s*\d/,
  /T\+\d/,
  /bội số của \d/,
  /\b0[.,]1\s*%/,
];
const PATTERNS = [...IDENTIFIERS, ...LITERALS];

function sourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return (fs.readdirSync(dir, { recursive: true }) as string[])
    .filter((rel) => /\.tsx?$/.test(rel) && !/\.test\.tsx?$/.test(rel) && !/(^|[\\/])(\.next|node_modules)[\\/]/.test(rel))
    .map((rel) => path.join(dir, rel));
}

describe('R5: no hard-coded market rules in web or worker', () => {
  it('no rule literals or default imports in web/worker source', () => {
    const offenders: string[] = [];
    for (const dir of DIRS) {
      for (const file of sourceFiles(dir)) {
        const src = fs.readFileSync(file, 'utf8');
        for (const re of PATTERNS) {
          if (!re.test(src)) continue;
          if (ALLOWLIST.some((a) => file.endsWith(a.file) && a.pattern.source === re.source)) continue;
          offenders.push(`${path.relative(webRoot, file)}: ${re}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('scanner flags known-bad samples', () => {
    const bad = [
      'DEFAULT_TRADING_RULES',
      'DEFAULT_MARKET_SETTINGS',
      'DEFAULT_MARKET_RULES',
      'DEFAULT_CONCENTRATION_THRESHOLD_PPM',
      'const x = { lotSize: 100 }',
      'settlementDays = 2',
      'feeRatePpm: 1500',
      'HOSE: 7',
      '"UPCOM": 15',
      'sau T+2 mới',
      'bội số của 100',
      'thuế 0,1%',
    ];
    for (const sample of bad) expect(PATTERNS.some((re) => re.test(sample)), sample).toBe(true);
    for (const re of PATTERNS) expect(bad.some((sample) => re.test(sample)), String(re)).toBe(true);
  });

  it('scans a non-empty set of files', () => {
    expect(DIRS.flatMap(sourceFiles).length).toBeGreaterThan(20);
  });
});
