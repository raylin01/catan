import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
import {RoomStore} from './store.js';
import {RoomService} from './roomService.js';
import {applyPatch, captureState} from './recording.js';
import {playScriptedMatch} from './fixtures/scriptedMatch.js';

const digest = state => createHash('sha256').update(JSON.stringify(state)).digest('hex');

test('a complete scripted match replays every committed state after restart and through JSONL', {timeout: 300_000}, () => {
  const dir = mkdtempSync(join(tmpdir(), 'catan-replay-match-'));
  let store;
  try {
    const path = join(dir, 'rooms.sqlite');
    store = new RoomStore(path);
    let tick = 1_800_000_000_000;
    let service = new RoomService({store, now: () => tick += 1000});
    const expected = new Map();
    const match = playScriptedMatch({service, seed: 0xC47A2026, title: 'Replay round-trip test',
      onTransition: ({room}) => {
        const seq = service.recordingFor(room.recordingId).lastSeq;
        expected.set(seq, digest(captureState(room)));
      }
    });
    assert.equal(match.status, 'finished');
    assert.ok(expected.size > 100, 'exercise a full match and multiple checkpoint boundaries');
    store.close();
    store = new RoomStore(path);
    service = new RoomService({store});
    for (const [seq, hash] of expected) {
      const frame = service.replay(match.replayId, {at: seq, perspective: 'omniscient'});
      assert.equal(frame.success, true);
      assert.equal(frame.seq, seq);
      assert.equal(digest(frame.state), hash, `state at event ${seq}`);
    }
    const final = service.replay(match.replayId, {perspective: 'omniscient'});
    assert.equal(final.recording.status, 'won');
    assert.equal(final.recording.winnerId, final.state.gameState.winner);
    assert.equal(final.recording.sample, true);
    const exportText = service.replayExport(match.replayId, {perspective: 'omniscient'}).lines.join('');
    let state, checked = 0;
    for (const line of exportText.trim().split('\n')) {
      const record = JSON.parse(line);
      if (record.kind === 'initial') state = record.state;
      if (record.kind === 'event') {
        state = applyPatch(state, record.patch);
        if (expected.has(record.seq)) {
          assert.equal(digest(state), expected.get(record.seq), `export state at ${record.seq}`);
          checked++;
        }
      }
      if (record.kind === 'checkpoint') assert.deepEqual(record.state, state);
    }
    assert.equal(checked, expected.size);
    const eventTypes = new Set(service.eventsFor(match.replayId).map(event => event.type));
    for (const type of ['rollDice', 'tradeConfirm', 'discardCards', 'moveRobber', 'chooseRobberCard', 'buyDevCard', 'playDevCard', 'chat']) {
      assert.ok(eventTypes.has(type), `recorded ${type}`);
    }
    const metrics = service.replayMetrics(match.replayId, {perspective: 'omniscient'}).points.at(-1);
    for (const player of final.state.gameState.players) {
      const metric = metrics.players.find(item => item.id === player.id);
      assert.equal(metric.totalVP, player.victoryPoints + player.hiddenVictoryPoints);
      assert.equal(metric.roads, Object.values(final.state.gameState.edges).filter(edge => edge.owner === final.state.gameState.players.indexOf(player)).length);
    }
    console.log(JSON.stringify({replayedStates: checked, events: final.recording.lastSeq,
      jsonlBytes: Buffer.byteLength(exportText), gzipBytes: gzipSync(exportText).length}));
  } finally {
    store?.close();
    rmSync(dir, {recursive: true, force: true});
  }
});
