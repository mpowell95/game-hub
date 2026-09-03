// golf/js/meters.js - pure bar motion and input mapping. No timers, no DOM.
// ui.js calls pos(tNow - tStart, T) each frame to draw the marker and calls the same
// function once at tap time to read the value.

export function pos(t, T) {            // t seconds since bar started, T = one left->right pass
  return 0.5 - 0.5 * Math.cos(Math.PI * t / T);
}
export function aimDeg(p, rangeDeg) { return (p - 0.5) * 2 * rangeDeg; }   // -range..+range
export function power01(p) { return p; }                                   // 0..1
export function spin01(p) { return (p - 0.5) * 2; }                        // -1 back .. +1 top

export const DIFF = {
  casual:   { aimT: 1.6, powerT: 1.4, spinT: 1.4, aimRange: 10, puttRange: 5, sweet: [0.88, 1.0], windMax: 2.7 },
  standard: { aimT: 1.1, powerT: 1.0, spinT: 1.0, aimRange: 12, puttRange: 6, sweet: [0.92, 1.0], windMax: 5.4 },
  pro:      { aimT: 0.8, powerT: 0.7, spinT: 0.7, aimRange: 14, puttRange: 7, sweet: [0.95, 1.0], windMax: 8.9 },
};
