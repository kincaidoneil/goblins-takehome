/**
 * Seeded random numbers, so a simulation with the same seed makes the same names, schedule and
 * whiteboard choices. The recorded demo and a re-run load-test step depend on that.
 */
export interface Rng {
  /** Uniform in [0, 1). */
  readonly next: () => number;
}

/** mulberry32: small, fast and good enough for scheduling. Not for anything secret. */
export const seededRng = (seed: number): Rng => {
  let state = seed >>> 0;
  return {
    next: () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
};

/** A child generator whose stream depends only on the parent seed and `label`. */
export const forkRng = (seed: number, label: string): Rng => {
  let hash = seed >>> 0;
  for (let i = 0; i < label.length; i++) {
    hash = Math.imul(hash ^ label.charCodeAt(i), 0x01000193) >>> 0;
  }
  return seededRng(hash);
};

export const uniform = (rng: Rng, min: number, max: number): number =>
  min + (max - min) * rng.next();

export const chance = (rng: Rng, probability: number): boolean => rng.next() < probability;

/** Picks from `items` with probability proportional to `weight`. `items` must be non-empty. */
export const weighted = <A>(
  rng: Rng,
  items: readonly [A, ...ReadonlyArray<A>],
  weight: (item: A) => number,
): A => {
  const total = items.reduce((sum, item) => sum + weight(item), 0);
  let target = rng.next() * total;
  for (const item of items) {
    target -= weight(item);
    if (target < 0) return item;
  }
  return items[items.length - 1] ?? items[0];
};
