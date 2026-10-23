import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');
const FORBIDDEN = [
  /\breduce\(/,
  /\.toFixed\(/,
  /\bMath\./,
  /\bparseFloat\(/,
  /\bparseInt\(/,
  /[*/]\s*100\b/,
  /\/\s*1000\b/,
  /Date\.now\(/,
  /new Date\(/,
];

describe('R1: no calculation in UI', () => {
  it('has no arithmetic or clock access in components and app', () => {
    const offenders: string[] = [];
    for (const dir of ['components', 'app']) {
      const base = path.join(root, dir);
      for (const rel of fs.readdirSync(base, { recursive: true }) as string[]) {
        if (!rel.endsWith('.tsx') || rel.endsWith('.test.tsx')) continue;
        const src = fs.readFileSync(path.join(base, rel), 'utf8');
        for (const re of FORBIDDEN) if (re.test(src)) offenders.push(`${dir}/${rel}: ${re}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
