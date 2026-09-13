import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { formatDuration, playerColor } from './replayUtils';
import { buildChart, chartPointAt, chartValue, CHARTS, CHART_SIZE } from './chartModel';

export default function ReplayChart({ points = [], players = [], chart = 'vp', timeMs = 0, seq = 0, onSeek }) {
  const definition = CHARTS[chart] || CHARTS.vp;
  const surface = useRef(null);
  const [chartWidth, setChartWidth] = useState(CHART_SIZE.width);
  const size = useMemo(() => ({...CHART_SIZE, width: chartWidth, height: chartWidth < 500 ? 220 : 280}), [chartWidth]);
  const data = useMemo(() => buildChart(points, players, definition, size), [points, players, definition, size]);
  useEffect(() => {
    if (!surface.current) return undefined;
    const observer = new ResizeObserver(entries => setChartWidth(Math.max(280, Math.round(entries[0].contentRect.width))));
    observer.observe(surface.current);
    return () => observer.disconnect();
  }, [points.length, players.length]);
  const [hoverTime, setHoverTime] = useState(null);
  const [keyboardTime, setKeyboardTime] = useState(null);
  const [highlight, setHighlight] = useState(null);
  const [tableOpen, setTableOpen] = useState(false);
  const id = useId();
  const inspectedTime = hoverTime ?? keyboardTime;
  const cursorTime = inspectedTime ?? timeMs;
  const point = inspectedTime == null ? chartPointAt(points, seq, 'seq') : chartPointAt(points, cursorTime);
  const {width, height, left, right, top, bottom} = size;
  const pointerTime = event => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)) * data.maxTime;
  };
  if (!points.length || !players.length) return <div className="replay-empty-compact">No chart points were recorded for this match.</div>;

  return <div className="replay-chart-wrap">
    <div className="replay-chart-readout">
      <span>{inspectedTime == null ? 'At playhead' : 'Inspecting'} <strong>{formatDuration(cursorTime)}</strong></span>
      <span>{point?.turn == null ? 'Lobby' : `Turn ${point.turn + 1}`}</span>
    </div>
    <div className="replay-chart-legend" aria-label="Highlight a player">
      {players.map((player, index) => <button type="button" key={player.id} aria-pressed={highlight === player.id}
        className={highlight != null && highlight !== player.id ? 'is-dimmed' : ''}
        style={{'--chart-player': playerColor(player, index)}} onClick={() => setHighlight(value => value === player.id ? null : player.id)}>
        <span className="replay-chart-player"><i aria-hidden="true"/>{player.name}</span>
        <span className="replay-chart-value">{chartValue(point?.players?.find(p => p.id === player.id), definition)} <small>{definition.suffix}</small></span>
      </button>)}
    </div>
    <div ref={surface} className="replay-chart-surface">
      <svg className="replay-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${id}-title ${id}-desc`}>
        <title id={`${id}-title`}>{definition.label} over the match</title>
        <desc id={`${id}-desc`}>Steps show recorded changes. The gold line marks playback. Use the time slider or match data below to inspect and jump to a moment.</desc>
        {data.ticks.map(tick => <g key={tick}>
          <line className="replay-chart-grid" x1={left} x2={width-right} y1={data.y(tick)} y2={data.y(tick)}/>
          <text className="replay-chart-axis" x={left-10} y={data.y(tick)+4} textAnchor="end">{tick}</text>
        </g>)}
        {(chartWidth < 500 ? [0,.5,1] : [0,.25,.5,.75,1]).map(fraction => <text key={fraction} className="replay-chart-axis" x={data.x(fraction*data.maxTime)} y={height-10} textAnchor={fraction===0?'start':fraction===1?'end':'middle'}>{fraction===0?'Start':formatDuration(fraction*data.maxTime)}</text>)}
        {data.lines.map(({player, path}, index) => <path key={player.id} className="replay-chart-line" d={path} fill="none"
          stroke={playerColor(player,index)} strokeDasharray={index===1?'7 3':index===2?'2 3':index===3?'10 3 2 3':undefined}
          opacity={highlight != null && highlight !== player.id ? .16 : 1}/>)}
        <line className="replay-chart-playhead" x1={data.x(timeMs)} x2={data.x(timeMs)} y1={top-8} y2={height-bottom}/>
        <path className="replay-chart-playhead-cap" d={`M${data.x(timeMs)-4},${top-10}h8l-4,6Z`}/>
        {inspectedTime != null && <line className="replay-chart-cursor" x1={data.x(cursorTime)} x2={data.x(cursorTime)} y1={top} y2={height-bottom}/>}
        {players.map((player,index) => <circle key={player.id} cx={data.x(cursorTime)} cy={data.y(chartValue(point?.players?.find(p=>p.id===player.id),definition))} r={highlight===player.id?5:3.5}
          fill={playerColor(player,index)} stroke="#10242b" strokeWidth="1.5" opacity={highlight != null && highlight !== player.id ? .16 : 1}/>)}
      </svg>
      <div className="replay-chart-hit-area" aria-hidden="true"
        style={{left:`${left/width*100}%`,right:`${right/width*100}%`,top:`${top/height*100}%`,bottom:`${bottom/height*100}%`}}
        onPointerMove={event=>setHoverTime(pointerTime(event))} onPointerLeave={()=>setHoverTime(null)}
        onClick={event=>{onSeek?.(chartPointAt(points,pointerTime(event))?.seq || 0);setKeyboardTime(null);}}/>
    </div>
    <div className="replay-chart-scrub">
      <label htmlFor={`${id}-time`}>Inspect time</label>
      <input id={`${id}-time`} type="range" min="0" max={data.maxTime} step="1" value={cursorTime}
        aria-valuetext={`${formatDuration(cursorTime)}${point?.turn==null?'':`, turn ${point.turn+1}`}`}
        onFocus={()=>{setHoverTime(null);setKeyboardTime(timeMs);}} onChange={event=>setKeyboardTime(Number(event.target.value))}
        onKeyDown={event=>{
          setHoverTime(null);
          if (event.key === 'Enter') { event.preventDefault(); onSeek?.(point?.seq||0); setKeyboardTime(null); }
          const direction = {ArrowRight:1,ArrowUp:1,ArrowLeft:-1,ArrowDown:-1}[event.key];
          if (direction) { event.preventDefault(); setKeyboardTime(Math.max(0,Math.min(data.maxTime,cursorTime+direction*1000))); }
        }}/>
      <button type="button" onClick={()=>{onSeek?.(point?.seq||0);setKeyboardTime(null);}}>Jump here</button>
    </div>
    <details className="replay-chart-table" onToggle={event=>setTableOpen(event.currentTarget.open)}>
      <summary>Match data <span>{points.length.toLocaleString()} recorded moments</span></summary>
      {tableOpen && <div className="replay-table-scroll"><table>
        <thead><tr><th scope="col">Time</th><th scope="col">Turn</th>{players.map(player=><th scope="col" key={player.id}>{player.name}</th>)}</tr></thead>
        <tbody>{points.map((entry,index)=><tr key={`${entry.seq}-${index}`}>
          <th scope="row"><button type="button" className="replay-text-button" onClick={()=>onSeek?.(entry.seq)}>{formatDuration(entry.elapsedMs)}</button></th>
          <td>{entry.turn==null?'—':entry.turn+1}</td>
          {players.map(player=><td key={player.id}>{chartValue(entry.players?.find(p=>p.id===player.id),definition)}</td>)}
        </tr>)}</tbody>
      </table></div>}
    </details>
  </div>;
}
