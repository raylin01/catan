import test from 'node:test';
import assert from 'node:assert/strict';
import {buildChart, chartPointAt, chartValue, CHARTS, CHART_SIZE} from './chartModel.js';

const players = [{id: 'a'}, {id: 'b'}];
const points = [
  {seq: 1, elapsedMs: 100, players: [{id:'a',publicVP:2,totalVP:3,roads:2}]},
  {seq: 2, elapsedMs: 200, players: [{id:'a',publicVP:3,totalVP:4,roads:3}]},
  {seq: 3, elapsedMs: 200, players: [{id:'a',publicVP:3,totalVP:5,roads:3}]},
  {seq: 4, elapsedMs: 400, players: [{id:'a',publicVP:2,totalVP:4,roads:3}]}
];
test('inspection resolves duplicate timestamps and individual sequence positions', () => {
  assert.equal(chartPointAt(points,99), null);
  assert.equal(chartPointAt(points,199).seq,1);
  assert.equal(chartPointAt(points,200).seq,3);
  assert.equal(chartPointAt(points,2,'seq').seq,2);
  assert.equal(chartPointAt(points,999).seq,4);
  assert.equal(chartPointAt([],999),null);
});
test('scores use only fields present in the supplied perspective', () => {
  assert.equal(chartValue({publicVP:2},CHARTS.vp),2);
  assert.equal(chartValue({publicVP:2,totalVP:4},CHARTS.vp),4);
  assert.equal(chartValue({publicVP:2,totalVP:0},CHARTS.vp),0);
  assert.equal(chartValue(undefined,CHARTS.vp),0);
});
test('chart steps change at event time, preserve losses and avoid interpolated scores', () => {
  const model=buildChart(points,players,CHARTS.vp);
  assert.equal(model.lines[0].path,`M${model.x(0)},${model.y(0)}H${model.x(100)}V${model.y(3)}H${model.x(200)}V${model.y(4)}H${model.x(200)}V${model.y(5)}H${model.x(400)}V${model.y(4)}H${model.x(400)}`);
  const roads=buildChart(points,players,CHARTS.roads);
  assert.equal((roads.lines[0].path.match(/V/g)||[]).length,2);
});
test('integer grid labels align with the actual scale for uneven maxima', () => {
  const model=buildChart([{elapsedMs:900,players:[{id:'a',publicVP:7}]}],players,CHARTS.vp);
  assert.deepEqual(model.ticks,[0,2,4,6,8]);
  assert.equal(model.y(8),CHART_SIZE.top);
  assert.equal(model.y(4),(CHART_SIZE.top+CHART_SIZE.height-CHART_SIZE.bottom)/2);
  assert.equal(model.x(900),CHART_SIZE.width-CHART_SIZE.right);
  assert.equal(model.x(-10),CHART_SIZE.left);
});
test('empty and long recordings produce finite scales without argument overflow', () => {
  assert.equal(buildChart([],[],CHARTS.vp).ceiling,1);
  const many=Array.from({length:150000},(_,i)=>({seq:i,elapsedMs:i,players:[{id:'a',publicVP:2}]}));
  const model=buildChart(many,players,CHARTS.vp);
  assert.equal(model.maxTime,149999);
  assert.equal(model.lines[0].path.split('V').length,2);
});
