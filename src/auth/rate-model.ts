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
 *
 * The configured refill is a *ceiling*, not gospel. A server's true rate is
 * rarely known exactly and can shift with load, so the model self-calibrates:
 * an observed 429 (`penalize`) multiplies the lane's send interval, easing the
 * pace below the ceiling until the rejections stop; quiet time decays that
 * penalty back toward the ceiling. This matters most for headerless limiters
 * (FPL's OpenResty bucket sends no Retry-After), where the 429 itself is the
 * only feedback the client gets.
 */
export interface TokenBucketConfig {
  /** Tokens a full bucket holds - the burst the server tolerates. */
  capacity: number;
  /** Tokens the bucket regains per second - the sustained rate (the ceiling). */
  refill: number;
  /**
   * Pace at `safety * refill` for headroom against clock skew and jitter, so
   * the model stays strictly under the server's real rate. Range (0, 1], default 1.
   */
  safety?: number;
  /**
   * Multiply a lane's send interval by this on every observed 429 (>= 1,
   * default 2). Each rejection roughly halves the lane's effective rate, so a
   * too-high ceiling is corrected within a few 429s rather than sustained.
   */
  rejectBackoff?: number;
  /**
   * Cap on the cumulative slowdown a lane can accrue (>= 1, default 32), so a
   * burst of rejections can't push the pace to effectively zero and strand the
   * lane. At the cap the rate is `refill / maxSlowdown`.
   */
  maxSlowdown?: number;
  /**
   * Time constant (ms) for a penalty to decay back toward the ceiling once the
   * rejections stop (default 30_000). The excess slowdown falls off
   * exponentially with this constant, so a lane that was throttled eases back
   * up to the configured rate after it goes quiet.
   */
  recoveryMs?: number;
}

interface LaneState {
  /** Theoretical arrival time of the next steady-schedule slot. */
  tat: number;
  /** Cumulative slowdown multiplier on the base interval (>= 1). */
  slowdown: number;
  /** When `slowdown` was last written, for time-decay of the penalty. */
  slowdownAt: number;
}

const DEFAULT_REJECT_BACKOFF = 2;
const DEFAULT_MAX_SLOWDOWN = 32;
const DEFAULT_RECOVERY_MS = 30_000;

export class TokenBucketModel {
  /** ms between tokens at the (safety-adjusted) ceiling rate, before slowdown. */
  private readonly baseEmitMs: number;
  /** How far ahead of the steady schedule a full bucket may run, in ms. */
  private readonly burstMs: number;
  private readonly rejectBackoff: number;
  private readonly maxSlowdown: number;
  private readonly recoveryMs: number;
  /** Per-lane schedule and adaptive slowdown. */
  private readonly lanes = new Map<string, LaneState>();

  constructor(config: TokenBucketConfig) {
    const safety = clampSafety(config.safety);
    const rate = config.refill * safety;
    if (!(rate > 0)) {
      throw new Error(`TokenBucketModel: refill must be > 0 (got ${config.refill})`);
    }
    if (!(config.capacity >= 1)) {
      throw new Error(`TokenBucketModel: capacity must be >= 1 (got ${config.capacity})`);
    }
    this.rejectBackoff = requireAtLeastOne(
      'rejectBackoff',
      config.rejectBackoff,
      DEFAULT_REJECT_BACKOFF
    );
    this.maxSlowdown = requireAtLeastOne('maxSlowdown', config.maxSlowdown, DEFAULT_MAX_SLOWDOWN);
    this.recoveryMs = requirePositive('recoveryMs', config.recoveryMs, DEFAULT_RECOVERY_MS);
    this.baseEmitMs = 1000 / rate;
    // Under-claim the burst by the same safety factor as the rate, so the model
    // stays under the server on both axes - a full-capacity burst can otherwise
    // collide with the server's own timing at the edge.
    const effectiveCapacity = Math.max(1, config.capacity * safety);
    this.burstMs = (effectiveCapacity - 1) * this.baseEmitMs;
  }

  /**
   * Reserve a token for `lane` and return how long to wait (ms) before sending.
   * Advances the lane's schedule, so this must be called once per request.
   */
  reserve(lane: string, now: number): number {
    const state = this.decayed(lane, now);
    const emit = this.baseEmitMs * state.slowdown;
    // A stored TAT in the past (or an untracked lane) means the bucket has
    // refilled to full: start the schedule from now.
    const tat = Math.max(state.tat, now);
    const wait = Math.max(0, tat - this.burstMs - now);
    state.tat = tat + emit;
    this.lanes.set(lane, state);
    return wait;
  }

  /**
   * Wait a reservation would return right now, without consuming a token. The
   * pending wait is the distance to the next scheduled slot, already baked into
   * `tat` by the last reservation, so it doesn't depend on the current slowdown.
   */
  peek(lane: string, now: number): number {
    const existing = this.lanes.get(lane);
    if (!existing) return 0;
    const tat = Math.max(existing.tat, now);
    return Math.max(0, tat - this.burstMs - now);
  }

  /**
   * Record that the server rejected a request on `lane` (a 429). Slows the
   * lane's pace multiplicatively and drains any banked burst, so the client
   * eases below the ceiling instead of hammering the same rate that just failed.
   */
  penalize(lane: string, now: number): void {
    const state = this.decayed(lane, now);
    state.slowdown = Math.min(this.maxSlowdown, state.slowdown * this.rejectBackoff);
    state.slowdownAt = now;
    // Drain the burst: a rejection means the bucket is empty, so don't hand out
    // a free burst on the next reservation.
    state.tat = Math.max(state.tat, now + this.burstMs);
    this.lanes.set(lane, state);
  }

  /** Current slowdown multiplier on `lane` (>= 1), after time-decay. For tests/observability. */
  slowdownOf(lane: string, now: number): number {
    const existing = this.lanes.get(lane);
    return existing ? this.decaySlowdown(existing, now) : 1;
  }

  /** Lane state with its slowdown decayed to `now` and written back. */
  private decayed(lane: string, now: number): LaneState {
    const existing = this.lanes.get(lane);
    if (!existing) {
      return { tat: now, slowdown: 1, slowdownAt: now };
    }
    existing.slowdown = this.decaySlowdown(existing, now);
    existing.slowdownAt = now;
    return existing;
  }

  /** Exponential decay of the excess slowdown back toward 1 over `recoveryMs`. */
  private decaySlowdown(state: LaneState, now: number): number {
    if (state.slowdown <= 1) return 1;
    const elapsed = Math.max(0, now - state.slowdownAt);
    const excess = (state.slowdown - 1) * Math.exp(-elapsed / this.recoveryMs);
    return excess > 1e-6 ? 1 + excess : 1;
  }
}

function clampSafety(safety: number | undefined): number {
  if (safety === undefined) return 1;
  if (!(safety > 0) || safety > 1) {
    throw new Error(`TokenBucketModel: safety must be in (0, 1] (got ${safety})`);
  }
  return safety;
}

function requireAtLeastOne(name: string, value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!(value >= 1)) {
    throw new Error(`TokenBucketModel: ${name} must be >= 1 (got ${value})`);
  }
  return value;
}

function requirePositive(name: string, value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!(value > 0)) {
    throw new Error(`TokenBucketModel: ${name} must be > 0 (got ${value})`);
  }
  return value;
}
