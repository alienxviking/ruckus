// Network models for tests and the latency harness (not shipped to browsers; pure logic).
//
// `burstyLink` imitates what was measured between a Wi-Fi client and the live server: a fast
// base delay, small jitter, and frequent stalls during which everything queues up and then lands
// at once (TCP head-of-line blocking after a lost packet): 100-1500 ms round trips, 60-75% of
// messages arriving within 5 ms of the previous one after gaps of 0.3-1.8 s.

export interface Link {
  /** A message sent at `at` (ms) arrives at the returned time. In order, like TCP. */
  send(at: number): number;
}

export interface BurstyOptions {
  /** One-way delay with nothing in the way (ms). */
  base?: number;
  /** Mean of the extra exponential jitter (ms). */
  jitter?: number;
  /** Stalls per second. */
  stalls?: number;
  /** Stall length range (ms); one in ten is twice as long. */
  stallMin?: number;
  stallMax?: number;
  /** Deliveries come in batches on this grid (ms; Wi-Fi power save wakes up on beacons). 0 = off. */
  quantum?: number;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function burstyLink(seed: number, o: BurstyOptions = {}): Link {
  const { base = 35, jitter = 10, stalls = 1.2, stallMin = 80, stallMax = 450, quantum = 0 } = o;
  const rand = rng(seed);
  let last = -Infinity;
  let stallFrom = NaN;
  let stallTo = NaN;
  const nextStall = (after: number) => {
    stallFrom = after + (-Math.log(1 - rand()) * 1000) / stalls;
    const len = stallMin + rand() * (stallMax - stallMin);
    stallTo = stallFrom + (rand() < 0.1 ? len * 2 : len);
  };
  return {
    send(at) {
      if (Number.isNaN(stallFrom)) nextStall(at);
      while (at > stallTo) nextStall(stallTo);
      let arrive = at + base - Math.log(1 - rand()) * jitter;
      // Sent during a stall: held until it clears, then everything lands together.
      if (at >= stallFrom && at < stallTo) arrive = Math.max(arrive, stallTo + rand() * 3);
      if (quantum > 0) arrive = Math.ceil(arrive / quantum) * quantum + rand() * 2;
      arrive = Math.max(arrive, last + 0.05);
      last = arrive;
      return arrive;
    },
  };
}

/** A fixed delay (the old tests' links). */
export function fixedLink(ms: number): Link {
  return { send: (at) => at + ms };
}

/**
 * A link that replays recorded lateness: `late[i]` ms extra for the message sent in slot i (slots
 * `slotMs` apart, cycling), on top of `base`. In order, so recorded bunches stay bunched.
 */
export function traceLink(late: number[], base: number, slotMs: number): Link {
  let last = -Infinity;
  let t0 = NaN;
  return {
    send(at) {
      if (Number.isNaN(t0)) t0 = at;
      const i = Math.floor((at - t0) / slotMs) % late.length;
      const arrive = Math.max(at + base + late[i], last + 0.05);
      last = arrive;
      return arrive;
    },
  };
}

/** Matches the typical live measurements (lateness p95 ~270 ms, ~55% of messages bunched). */
export const WIFI: BurstyOptions = { stalls: 1.2, stallMin: 80, stallMax: 450, quantum: 102.4 };
/** Matches the worst live run (round trips to 1.5 s, gaps to 1.8 s). */
export const WIFI_BAD: BurstyOptions = { stalls: 1.5, stallMin: 150, stallMax: 700, quantum: 204.8 };
