/**
 * A local model of the server's rate limiter, so a client can pace *under* the
 * limit rather than discovering it by getting a 429.
 *
 * Token bucket via GCRA (generic cell rate algorithm): the standard scheduler
 * for "burst up to capacity, then steady at refill". State is a single
 * timestamp per lane - the theoretical arrival time (TAT) of the next request
 * on the steady schedule. A reservation reads and advances it synchronously, so
 * concurrent callers can't all read the same "now" and fire together; each is
 * handed a strictly later slot.
 */
export interface TokenBucketConfig {
  /** Tokens a full bucket holds - the burst the server tolerates. */
  capacity: number;
  /** Tokens the bucket regains per second - the sustained rate. */
  refill: number;
  /**
   * Pace at `safety * refill` for headroom against clock skew and jitter, so
   * the model stays strictly under the server's real rate. Range (0, 1], default 1.
   */
  safety?: number;
}

export class TokenBucketModel {
  /** ms between tokens at the (safety-adjusted) steady rate. */
  private readonly emitMs: number;
  /** How far ahead of the steady schedule a full bucket may run, in ms. */
  private readonly burstMs: number;
  /** Theoretical arrival time of the next steady-schedule slot, per lane. */
  private readonly tat = new Map<string, number>();

  constructor(config: TokenBucketConfig) {
    const safety = clampSafety(config.safety);
    const rate = config.refill * safety;
    if (!(rate > 0)) {
      throw new Error(`TokenBucketModel: refill must be > 0 (got ${config.refill})`);
    }
    if (!(config.capacity >= 1)) {
      throw new Error(`TokenBucketModel: capacity must be >= 1 (got ${config.capacity})`);
    }
    this.emitMs = 1000 / rate;
    // Under-claim the burst by the same safety factor as the rate, so the model
    // stays under the server on both axes - a full-capacity burst can otherwise
    // collide with the server's own timing at the edge.
    const effectiveCapacity = Math.max(1, config.capacity * safety);
    this.burstMs = (effectiveCapacity - 1) * this.emitMs;
  }

  /**
   * Reserve a token for `lane` and return how long to wait (ms) before sending.
   * Advances the lane's schedule, so this must be called once per request.
   */
  reserve(lane: string, now: number): number {
    // A stored TAT in the past (or an untracked lane) means the bucket has
    // refilled to full: start the schedule from now.
    const tat = Math.max(this.tat.get(lane) ?? now, now);
    const wait = Math.max(0, tat - this.burstMs - now);
    this.tat.set(lane, tat + this.emitMs);
    return wait;
  }

  /** Wait a reservation would return right now, without consuming a token. */
  peek(lane: string, now: number): number {
    const tat = Math.max(this.tat.get(lane) ?? now, now);
    return Math.max(0, tat - this.burstMs - now);
  }
}

function clampSafety(safety: number | undefined): number {
  if (safety === undefined) return 1;
  if (!(safety > 0) || safety > 1) {
    throw new Error(`TokenBucketModel: safety must be in (0, 1] (got ${safety})`);
  }
  return safety;
}
