import { describe, it, expect } from 'vitest';
import { tiltFromVertical, tiltScale } from '../src/app/sculptTool';
import { Viewport } from '../src/app/viewport';

describe('pen geometry', () => {
  it('tilt from vertical: upright, single-axis and combined tilt, altitude fallback', () => {
    expect(tiltFromVertical({ tiltX: 0, tiltY: 0 })).toBeCloseTo(0, 6);
    expect(tiltFromVertical({ tiltX: 45, tiltY: 0 })).toBeCloseTo(45, 6);
    expect(tiltFromVertical({ tiltX: 0, tiltY: -30 })).toBeCloseTo(30, 6);
    expect(tiltFromVertical({ tiltX: 45, tiltY: 45 })).toBeCloseTo(54.7356, 3);
    expect(tiltFromVertical({ altitudeAngle: Math.PI / 3 })).toBeCloseTo(30, 6);
  });
  it('tilt widens the brush monotonically, capped at 1.6x', () => {
    expect(tiltScale(0)).toBe(1); expect(tiltScale(30)).toBeCloseTo(1.3, 6); expect(tiltScale(60)).toBeCloseTo(1.6, 6); expect(tiltScale(89)).toBeCloseTo(1.6, 6);
  });
});

describe('adaptive pixel ratio', () => {
  it('Tab S9 Ultra in Chrome (1480x924 CSS @ DPR 2) is capped under the balanced budget', () => {
    const pr = Viewport.effectiveDpr(1480, 924, 2, Viewport.BUDGET.balanced);
    expect(pr).toBeGreaterThan(1.4); expect(pr).toBeLessThan(2);
    expect(1480 * 924 * pr * pr).toBeLessThanOrEqual(Viewport.BUDGET.balanced + 1);
  });
  it('small screens keep native DPR; never below 1; sharp allows native on the tablet', () => {
    expect(Viewport.effectiveDpr(390, 844, 3, Viewport.BUDGET.balanced)).toBe(3);
    expect(Viewport.effectiveDpr(4000, 3000, 1, Viewport.BUDGET.fast)).toBe(1);
    expect(Viewport.effectiveDpr(1480, 924, 2, Viewport.BUDGET.sharp)).toBe(2);
  });
});
