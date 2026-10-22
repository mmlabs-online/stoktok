import { describe, expect, it } from 'vitest';
import { describeCore } from './index';

describe('describeCore', () => {
  it('returns the core package name', () => {
    expect(describeCore()).toBe('@stoktok/core');
  });
});
