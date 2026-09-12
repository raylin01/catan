import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceReplayTime,
  buildTimelineMarkers,
  buildTurnBands,
  eventAtTime,
  groupTimelineMarkers,
  timeForSeq
} from '../client/src/replay/timelineModel.js';

const events = [
  {seq: 3, elapsedMs: 2700, type: 'endTurn'},
  {seq: 1, elapsedMs: 500, type: 'rollDice'},
  {seq: 2, elapsedMs: 500, type: 'moveRobber', summary: 'Ada moved the robber', actorSeatId: 'ada'}
];

test('real-time event lookup resolves timestamp order and latest same-time sequence', () => {
  assert.equal(eventAtTime(events, 499), null);
  assert.equal(eventAtTime(events, 500)?.seq, 2);
  assert.equal(eventAtTime(events, 2699)?.seq, 2);
  assert.equal(eventAtTime(events, 2700)?.seq, 3);
  assert.equal(timeForSeq(events, 2), 500);
  assert.equal(timeForSeq(events, 99), 0);
});

test('clock advances in elapsed milliseconds at speed and clamps to duration', () => {
  assert.equal(advanceReplayTime({timeMs: 500, deltaMs: 250, speed: 2, durationMs: 2000, events}), 1000);
  assert.equal(advanceReplayTime({timeMs: 1800, deltaMs: 500, speed: 1, durationMs: 2000, events}), 2000);
  assert.equal(advanceReplayTime({timeMs: 800, deltaMs: -100, speed: 4, durationMs: 2000, events}), 800);
});

test('idle skipping preserves 1200ms of a gap before landing on the next event', () => {
  const sparse = [{seq: 1, elapsedMs: 100}, {seq: 2, elapsedMs: 10100}, {seq: 3, elapsedMs: 10100}];
  assert.equal(advanceReplayTime({timeMs: 100, deltaMs: 1199, speed: 1, durationMs: 12000, events: sparse, skipIdle: true}), 1299);
  assert.equal(advanceReplayTime({timeMs: 100, deltaMs: 1200, speed: 1, durationMs: 12000, events: sparse, skipIdle: true}), 10100);
  assert.equal(advanceReplayTime({timeMs: 100, deltaMs: 1200, speed: 1, durationMs: 12000, events: sparse, skipIdle: false}), 1300);
  assert.equal(advanceReplayTime({timeMs: 10100, deltaMs: 500, speed: 1, durationMs: 20000, events: sparse, skipIdle: true}), 10600);
});

test('markers use visible VP only unless an explicit total is present', () => {
  const players = [{id: 'ada', name: 'Ada', color: '#f00'}, {id: 'bo', name: 'Bo', color: '#00f'}];
  const publicMetrics = [
    {seq: 0, elapsedMs: 0, turn: 0, currentPlayerId: 'ada', players: [{id: 'ada', publicVP: 1}]},
    {seq: 1, elapsedMs: 500, turn: 1, currentPlayerId: 'bo', players: [{id: 'ada', publicVP: 1}]},
    {seq: 2, elapsedMs: 900, turn: 1, currentPlayerId: 'bo', players: [{id: 'ada', publicVP: 2}]}
  ];
  const publicMarkers = buildTimelineMarkers([], publicMetrics, players).filter(marker => marker.type === 'victory-point');
  assert.deepEqual(publicMarkers.map(marker => marker.label), ['Ada gained 1 victory point']);

  const privateMetrics = [
    {seq: 0, elapsedMs: 0, players: [{id: 'ada', publicVP: 1, totalVP: 2}]},
    {seq: 1, elapsedMs: 400, players: [{id: 'ada', publicVP: 1, totalVP: 3}]}
  ];
  assert.equal(buildTimelineMarkers([], privateMetrics, players).find(marker => marker.type === 'victory-point')?.label, 'Ada gained 1 victory point');
  assert.equal(Object.hasOwn(publicMarkers[0], 'totalVP'), false);
  assert.equal(buildTimelineMarkers([], [
    {seq: 0, elapsedMs: 0, players: [{id: 'ada', publicVP: 1, totalVP: 4}]},
    {seq: 1, elapsedMs: 100, players: [{id: 'ada', publicVP: 2}]}
  ], players).some(marker => marker.type === 'victory-point'), false);
});

test('markers capture robber, win, turn, and award transitions without duplicates', () => {
  const players = [{id: 'ada', name: 'Ada', color: '#f00'}, {id: 'bo', name: 'Bo', color: '#00f'}];
  const metrics = [
    {seq: 0, elapsedMs: 0, turn: 0, currentPlayerId: 'ada', longestRoadPlayerId: null, largestArmyPlayerId: null, players: []},
    {seq: 2, elapsedMs: 500, turn: 1, currentPlayerId: 'bo', longestRoadPlayerId: 'ada', largestArmyPlayerId: null, players: []},
    {seq: 3, elapsedMs: 900, turn: 1, currentPlayerId: 'bo', longestRoadPlayerId: 'ada', largestArmyPlayerId: 'bo', winnerId: 'bo', players: []}
  ];
  const important = buildTimelineMarkers([
    {seq: 2, elapsedMs: 500, type: 'moveRobber', actorSeatId: 'ada', summary: 'Ada moved the robber'},
    {seq: 3, elapsedMs: 900, type: 'win', actorSeatId: 'bo', summary: 'Bo won'},
    {seq: 4, elapsedMs: 1100, type: 'placeRoad', actorSeatId: 'ada', summary: 'Winona placed a road'}
  ], metrics, players);
  assert.deepEqual(new Set(important.map(marker => marker.type)), new Set(['turn', 'longest-road', 'largest-army', 'robber', 'win']));
  assert.equal(important.filter(marker => marker.type === 'longest-road').length, 1);
  assert.equal(important.filter(marker => marker.type === 'win').length, 1);
});

test('dense markers group deterministically into bounded timeline buckets', () => {
  const markers = Array.from({length: 100}, (_, seq) => ({id: `m-${seq}`, seq, timeMs: seq * 10, type: 'turn', label: `Turn ${seq}`}));
  const groups = groupTimelineMarkers(markers, 1000, {bucketCount: 8});
  assert.equal(groups.length, 8);
  assert.equal(groups.flatMap(group => group.markers).length, 100);
  assert.deepEqual(groups[0].markers.slice(0, 3).map(marker => marker.seq), [0, 1, 2]);
  assert.deepEqual(groups.map(group => group.position), [6.25, 18.75, 31.25, 43.75, 56.25, 68.75, 81.25, 93.75]);
});

test('turn bands use elapsed time and actual player ownership', () => {
  const bands = buildTurnBands([
    {seq: 0, elapsedMs: 0, turn: 0, phase: 'setup', currentPlayerId: 'ada'},
    {seq: 2, elapsedMs: 700, turn: 0, phase: 'playing', currentPlayerId: 'bo'},
    {seq: 3, elapsedMs: 900, turn: 0, phase: 'playing', currentPlayerId: 'bo'}
  ], [{id: 'ada', name: 'Ada'}, {id: 'bo', name: 'Bo'}], 2000);
  assert.deepEqual(bands.map(band => [band.playerId, band.startMs, band.endMs]), [['ada', 0, 700], ['bo', 700, 2000]]);
  assert.deepEqual(bands.map(band => band.label), ['Ada · Setup', 'Bo · Turn 1']);
});
