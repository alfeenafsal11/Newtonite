export const MAX_BACKOFF_MS = 15 * 60 * 1000; // 15 minutes = 900,000 ms
export const BASE_BACKOFF_MS = 5 * 1000; // 5 seconds = 5,000 ms

export function computeBackoffMs(
  attempts: number,
  randomFn: () => number = Math.random
): number {
  if (attempts <= 0) attempts = 1;
  const exponential = BASE_BACKOFF_MS * Math.pow(2, attempts - 1);
  const capped = Math.min(exponential, MAX_BACKOFF_MS);
  const jitter = Math.floor(randomFn() * 1000); // 0 to 1000 ms (0..1s)
  return capped + jitter;
}
