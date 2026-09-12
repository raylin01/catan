#!/usr/bin/env node

import {existsSync, statSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {RoomStore} from '../server/store.js';
import {RoomService} from '../server/roomService.js';
import {playScriptedMatch} from '../server/fixtures/scriptedMatch.js';

const DEFAULT_BASE_TIME = 1_735_689_600_000;
const DEFAULT_MAX_TURNS = 1000;
const DEFAULT_PAUSED_TURNS = 6;
const SAMPLE_MATCHES = [
  {title: 'Mira, Jon and Cora: First Light', seed: 0xC47A2026},
  {title: 'Mira, Jon and Cora: Harbor Run', seed: 0x5A2A2026},
];

function usage() {
  return [
    'Usage: node scripts/create-replay-samples.js --db PATH [options]',
    '',
    'Creates two finished and one paused sample match in a new SQLite database.',
    'The --db path is required and an existing path is refused by default.',
    '',
    'Options:',
    '  --db PATH              New SQLite database path (required)',
    '  --base-time MS         Deterministic timestamp origin (default: fixed)',
    '  --max-turns N          Full-match turn cap (default: 1000)',
    '  --paused-turns N       Turns before pausing the third match (default: 6)',
    '  --help                 Show this help',
  ].join('\n');
}

function parseInteger(value, flag, {min = 0} = {}) {
  if (!/^\d+$/.test(value || '')) throw new Error(`${flag} must be a non-negative integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min) {
    throw new Error(`${flag} must be an integer >= ${min}`);
  }
  return parsed;
}

function parseArgs(argv) {
  const options = {db: null, baseTime: DEFAULT_BASE_TIME, maxTurns: DEFAULT_MAX_TURNS, pausedTurns: DEFAULT_PAUSED_TURNS};
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === '--help' || flag === '-h') return {...options, help: true};
    if (!['--db', '--base-time', '--max-turns', '--paused-turns'].includes(flag)) {
      throw new Error(`Unknown option ${flag}`);
    }
    const value = argv[++index];
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    if (flag === '--db') options.db = value;
    if (flag === '--base-time') options.baseTime = parseInteger(value, flag);
    if (flag === '--max-turns') options.maxTurns = parseInteger(value, flag, {min: 1});
    if (flag === '--paused-turns') options.pausedTurns = parseInteger(value, flag);
  }
  if (!options.db) throw new Error('--db PATH is required');
  if (options.db === ':memory:') throw new Error('--db must be a filesystem path');
  options.db = resolve(options.db);
  if (existsSync(options.db)) {
    throw new Error(`Refusing to use existing database path: ${options.db}`);
  }
  return options;
}

function deterministicClock(origin) {
  let current = origin;
  let commandIndex = 0;
  const gaps = [2_000, 6_000, 12_000, 4_000, 9_000, 3_000, 15_000, 5_000];
  const clock = () => current;
  clock.advance = ({type} = {}) => {
    // Keep sample timing plausible for replay scrubbing. These gaps are
    // synthetic and deliberately independent of game state or randomness.
    current += type === 'pause' ? 120_000 : gaps[commandIndex++ % gaps.length];
  };
  return clock;
}

function countRoomRecords(room) {
  const arrays = [room.events, room.cardEvents, room.chat];
  const journal = room.recording?.events || room.replay?.events || room.journal;
  if (Array.isArray(journal)) arrays.push(journal);
  return arrays.reduce((count, entries) => count + (Array.isArray(entries) ? entries.length : 0), 0);
}

function databaseBytes(path) {
  const paths = [path, `${path}-wal`, `${path}-shm`];
  return paths.reduce((total, candidate) => {
    try {
      return total + statSync(candidate).size;
    } catch {
      return total;
    }
  }, 0);
}

function outputSummary({db, service, matches}) {
  const rooms = [...service.rooms.values()];
  const recordings = service.listReplays({limit: 200}).recordings;
  const recordingEvents = recordings.reduce((count, recording) => count + (recording.lastSeq || 0), 0);
  const roomRecords = rooms.reduce((count, room) => count + countRoomRecords(room), 0);
  return {
    database: db,
    matches: matches.map(match => ({
      ...match.overview,
      recordingEventCount: typeof service.recordingFor === 'function' && match.replayId
        ? service.recordingFor(match.replayId)?.lastSeq ?? null
        : match.overview.recordingEventCount,
    })),
    storage: {
      bytes: databaseBytes(db),
      recordings: recordings.length,
      activeRooms: rooms.length,
      records: recordingEvents || roomRecords,
      roomViewRecords: roomRecords,
    },
  };
}

export function createReplaySamples({db, baseTime = DEFAULT_BASE_TIME, maxTurns = DEFAULT_MAX_TURNS,
  pausedTurns = DEFAULT_PAUSED_TURNS} = {}) {
  if (!db || typeof db !== 'string') throw new TypeError('db is required');
  if (!Number.isSafeInteger(baseTime) || baseTime < 0) throw new TypeError('baseTime must be a non-negative integer');
  if (!Number.isSafeInteger(maxTurns) || maxTurns < 1) throw new TypeError('maxTurns must be positive');
  if (!Number.isSafeInteger(pausedTurns) || pausedTurns < 0) throw new TypeError('pausedTurns must be non-negative');
  const databasePath = resolve(db);
  if (existsSync(databasePath)) throw new Error(`Refusing to use existing database path: ${databasePath}`);
  const clock = deterministicClock(baseTime);
  const store = new RoomStore(databasePath);
  const service = new RoomService({store, now: clock});
  try {
    const matches = SAMPLE_MATCHES.map(spec => playScriptedMatch({
      service,
      title: spec.title,
      seed: spec.seed,
      maxTurns,
      now: clock,
      sample: true,
    }));
    matches.push(playScriptedMatch({
      service,
      title: 'Mira, Jon and Cora: Paused Midgame',
      seed: 0x11A2B3C4,
      maxTurns,
      stopAfter: {turns: pausedTurns, pause: true},
      now: clock,
      sample: true,
    }));
    if (matches.filter(match => match.status === 'finished').length < 2) {
      throw new Error('Sample generation did not produce two finished matches');
    }
    if (!matches.some(match => match.status === 'paused' && match.paused)) {
      throw new Error('Sample generation did not produce a paused unfinished match');
    }
    return outputSummary({db: databasePath, service, matches});
  } finally {
    store.close();
  }
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return;
  }
  const summary = createReplaySamples(options);
  console.log(JSON.stringify(summary, null, 2));
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] || '')) {
  try {
    main();
  } catch (error) {
    console.error(`Sample generation failed: ${error.message}`);
    console.error(usage());
    process.exitCode = 1;
  }
}
