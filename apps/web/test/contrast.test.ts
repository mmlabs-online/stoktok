import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = fs.readFileSync(path.resolve(__dirname, '../app/globals.css'), 'utf8');

function block(selector: string): Record<string, string> {
  const m = new RegExp(`(?:^|\\n)${selector}\\s*\\{([^}]*)\\}`).exec(css);
  if (!m) throw new Error(`missing ${selector} block`);
  const vars: Record<string, string> = {};
  for (const v of m[1]!.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) vars[v[1]!] = v[2]!;
  return vars;
}

function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const TEXT = [
  '--color-fg',
  '--color-fg-muted',
  '--color-warn',
  '--price-up',
  '--price-down',
  '--price-ref',
  '--price-ceiling',
  '--price-floor',
];

describe('contrast (WCAG AA 4.5:1)', () => {
  const light = block(':root');
  const dark = { ...light, ...block('\\.dark') };
  for (const [name, t] of [
    ['light', light],
    ['dark', dark],
  ] as const) {
    for (const bg of ['--color-surface', '--color-bg']) {
      for (const fg of TEXT) {
        it(`${name}: ${fg} on ${bg}`, () => {
          expect(ratio(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
  }
});
