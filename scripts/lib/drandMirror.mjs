/**
 * CANONICAL COPY LIVES IN THE APP REPO (`cozgur/cipherbreaker`), at
 * `scripts/lib/drandMirror.mjs`. This is a duplicate, deployed here because
 * GitHub only schedules cron from a repository's default branch and this repo's
 * default branch is also what Pages serves — so the workflow, the script and the
 * published files sit together with no cross-repo token.
 *
 * Change the two together. What makes the duplication safe is a test that lives
 * with the canonical copy: `drandMirrorScript.test.ts` sweeps 730 days asserting
 * this arithmetic equals the app's own `game/daily/drand.ts`. If they diverge, the
 * mirror files a beacon under a date whose round the client computes differently,
 * every client silently rejects every mirror file, and nothing logs an error.
 */
/**
 * The drand mirror's arithmetic and validation — the half worth testing.
 *
 * Separated from the CLI in `scripts/mirror-daily-beacon.mjs` so
 * `drandMirrorScript.test.ts` can import it without executing a command-line
 * program, and so the module stays free of `import.meta` (which the app's babel
 * preset, aimed at Hermes, cannot transform).
 *
 * ## The one rule
 *
 * **A future day's beacon is never published.** Everything else in this file is
 * a preference; this is the security property. The whole point of seeding the
 * Daily from drand is that nobody — including us — can know a day's code before
 * that day starts. Publishing tomorrow's beacon today would hand us (and anyone
 * reading the mirror) tomorrow's puzzle, which puts us right back where we
 * started with a code we could have chosen.
 *
 * It is enforced twice below, deliberately: the target date must not be after
 * the runner's own UTC date, and the round must already have been emitted by the
 * chain. The second check is the one that actually holds if the runner's clock
 * is wrong, because the relay simply will not serve a round from the future.
 *
 * ## Arithmetic
 *
 * Duplicated from `src/game/daily/drand.ts` on purpose: this script runs in
 * plain Node in CI with no TypeScript toolchain, and pulling the app's module
 * graph in for four constants would be worse. `drandMirrorScript.test.ts` pins
 * that the values here and the values there agree, so the duplication cannot
 * drift silently.
 */

export const DRAND_CHAIN_HASH =
  '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971';
export const DRAND_GENESIS_TIME = 1_692_803_367;
export const DRAND_PERIOD_SECONDS = 3;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 'YYYY-MM-DD' from a Date's UTC parts. Never toISOString — see the app's rule. */
export function formatUTCDate(d) {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** UTC midnight of a 'YYYY-MM-DD', in milliseconds. */
export function utcMillisFor(date) {
  const m = DATE_RE.exec(date);
  if (m === null) throw new RangeError(`expected 'YYYY-MM-DD', got: ${date}`);
  const millis = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (formatUTCDate(new Date(millis)) !== date) {
    throw new RangeError(`invalid calendar date: ${date}`);
  }
  return millis;
}

/** The round emitted at 00:00:00 UTC of `date`. */
export function roundForDate(date) {
  const seconds = Math.floor(utcMillisFor(date) / 1000);
  if (seconds < DRAND_GENESIS_TIME) {
    throw new RangeError(`${date} precedes the quicknet genesis`);
  }
  return Math.floor((seconds - DRAND_GENESIS_TIME) / DRAND_PERIOD_SECONDS) + 1;
}

/** The UTC day a round belongs to — the guard's inverse check. */
export function dateForRound(round) {
  const seconds = DRAND_GENESIS_TIME + (round - 1) * DRAND_PERIOD_SECONDS;
  return formatUTCDate(new Date(seconds * 1000));
}

const RANDOMNESS_RE = /^[0-9a-f]{64}$/;
const SIGNATURE_RE = /^[0-9a-f]{96}$/;

/**
 * Fetch a round from the v1 endpoint, which returns `randomness` directly.
 *
 * Validated before it is written: a mirror file that fails the client's own
 * `parseDailyBeacon` is worse than no file, because it costs every player a
 * wasted request before they fall through to the relay.
 */
export async function fetchRound(round, fetchImpl = fetch) {
  const url = `https://api.drand.sh/${DRAND_CHAIN_HASH}/public/${round}`;
  const response = await fetchImpl(url, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`drand returned ${response.status} for round ${round} (${url})`);
  }
  const body = await response.json();
  if (body.round !== round) {
    throw new Error(`drand returned round ${body.round}, asked for ${round}`);
  }
  if (typeof body.randomness !== 'string' || !RANDOMNESS_RE.test(body.randomness)) {
    throw new Error(`round ${round}: randomness is not 32 hex bytes`);
  }
  if (typeof body.signature !== 'string' || !SIGNATURE_RE.test(body.signature)) {
    throw new Error(`round ${round}: signature is not a compressed G1 point`);
  }
  return { round, randomness: body.randomness, signature: body.signature };
}

/**
 * Build the record for `date`, refusing anything in the future.
 *
 * `today` is a parameter so the refusal is testable without waiting a day.
 */
export async function buildBeaconRecord(date, today, fetchImpl = fetch) {
  if (date > today) {
    throw new Error(
      `refusing to publish a future beacon: ${date} is after ${today}. ` +
        'A future day’s beacon is never published — it would hand us the puzzle early.',
    );
  }
  const round = roundForDate(date);
  // Belt to the braces above, and the check that survives a wrong clock: the
  // round must belong to the date we are filing it under.
  if (dateForRound(round) !== date) {
    throw new Error(`round ${round} belongs to ${dateForRound(round)}, not ${date}`);
  }
  const { randomness, signature } = await fetchRound(round, fetchImpl);
  return { date, round, randomness, signature };
}
