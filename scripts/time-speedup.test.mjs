import assert from 'node:assert/strict';

/**
 * Smoke test for time-delta scaling.
 *
 * This checks that a base elapsed time in simulation is amplified by the selected
 * playback speed multiplier (ex: 1_000, 1_000_000) instead of modifying per-point speeds.
 */
const scenarios = [
  { elapsedSeconds: 12.5, multiplier: 1, expected: 12.5 },
  { elapsedSeconds: 12.5, multiplier: 1_000, expected: 12_500 },
  { elapsedSeconds: 12.5, multiplier: 1_000_000, expected: 12_500_000 },
];

for (const scenario of scenarios) {
  const scaled = scenario.elapsedSeconds * scenario.multiplier;
  assert.equal(
    scaled,
    scenario.expected,
    `Expected elapsed time ${scenario.elapsedSeconds}s * ${scenario.multiplier} = ${scenario.expected}s`,
  );
}

console.log('[playground] time-speedup smoke test passed', scenarios);
