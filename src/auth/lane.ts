/**
 * Egress lane keys.
 *
 * Resilience state is tracked per egress IP, so http.ts addresses the rate
 * limiter and circuit breaker as `${sourceName}@${proxyLabel}` — one budget and
 * one circuit per proxy. Missions, however, declare `rateLimit` and
 * `circuitBreaker` against the source name alone. These helpers bridge the two.
 *
 * The proxy label is always `host:port` (see proxyLabel), and source names are
 * identifiers, so the last `@` is an unambiguous separator.
 */

export const LANE_SEPARATOR = '@';

/** Build a lane key for one source and egress label. */
export function laneKey(source: string, label?: string): string {
  return label ? `${source}${LANE_SEPARATOR}${label}` : source;
}

/** Strip the egress label from a lane key, yielding the bare source name. */
export function laneSource(key: string): string {
  const index = key.lastIndexOf(LANE_SEPARATOR);
  return index === -1 ? key : key.slice(0, index);
}
