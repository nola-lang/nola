/** The smallest axis the chart draws — an empty or all-running chart still gets a scale. */
const FLOOR_MS = 10;

/** Below this share of the axis the tallest bar is "small": the axis may shrink to fit it again. */
const SHRINK_BELOW = 0.25;

/** The next 1 / 2 / 5 × 10ⁿ at or above `max`. */
export function niceCeiling(max: number): number {
  if (!(max > FLOOR_MS)) return FLOOR_MS;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 5, 10]) if (step * magnitude >= max) return step * magnitude;
  return 10 * magnitude;
}

/**
 * The Y-axis ceiling for a live chart: it grows the moment a bar would not
 * fit, but holds while the tallest bar still uses a fair share of it — so
 * the axis does not rescale on every update, and a running bar that keeps
 * growing moves it in a few large steps instead of every tick.
 */
export function nextCeiling(previous: number | undefined, max: number): number {
  const nice = niceCeiling(max);
  if (previous === undefined || nice >= previous) return nice;
  return max < previous * SHRINK_BELOW ? nice : previous;
}
