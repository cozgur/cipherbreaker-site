#!/usr/bin/env node
/**
 * Publish one day's drand beacon to the site, so `cipherbreaker.app/daily/
 * <YYYY-MM-DD>.json` is the fast first source every client tries.
 *
 * ## The one rule
 *
 * **A future day's beacon is never published.** That is the security property
 * this whole feature rests on — see `scripts/lib/drandMirror.mjs`, which
 * enforces it, and the workflow in `.github/workflows/daily-beacon.yml`.
 *
 * ## Usage
 *
 *   node scripts/mirror-daily-beacon.mjs --out site/daily            # today
 *   node scripts/mirror-daily-beacon.mjs --out site/daily --date 2026-08-19
 *   node scripts/mirror-daily-beacon.mjs --dry-run                   # print only
 *   node scripts/mirror-daily-beacon.mjs --out site/daily --backfill 3
 *
 * `--backfill N` writes the last N days including today, which is how a gap
 * gets repaired after the Action has been failing for a while. It never reaches
 * forward, only back.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { buildBeaconRecord, formatUTCDate, utcMillisFor } from './lib/drandMirror.mjs';

function parseArgs(argv) {
  const args = { out: null, date: null, dryRun: false, backfill: 1 };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--out') args.out = argv[++i] ?? null;
    else if (flag === '--date') args.date = argv[++i] ?? null;
    else if (flag === '--dry-run') args.dryRun = true;
    else if (flag === '--backfill') args.backfill = Number(argv[++i] ?? '1');
    else throw new Error(`unknown flag: ${flag}`);
  }
  if (args.out === null && !args.dryRun) throw new Error('--out <dir> is required');
  if (!Number.isInteger(args.backfill) || args.backfill < 1 || args.backfill > 30) {
    throw new Error('--backfill must be an integer between 1 and 30');
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const today = formatUTCDate(new Date());
  const anchor = args.date ?? today;

  const dates = [];
  for (let i = 0; i < args.backfill; i += 1) {
    dates.push(formatUTCDate(new Date(utcMillisFor(anchor) - i * 86_400_000)));
  }

  for (const date of dates) {
    const record = await buildBeaconRecord(date, today);
    const json = `${JSON.stringify(record, null, 2)}\n`;
    if (args.dryRun) {
      process.stdout.write(`${date} -> round ${record.round}\n${json}`);
      continue;
    }
    await mkdir(args.out, { recursive: true });
    const path = join(args.out, `${date}.json`);
    await writeFile(path, json, 'utf8');
    process.stdout.write(`wrote ${path} (round ${record.round})\n`);
  }
}

// This file IS the command; the testable half lives in ./lib/drandMirror.mjs.
main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
