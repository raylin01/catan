import { useMemo } from 'react';
import { formatDuration, playerColor } from './replayUtils';

const CHARTS = {
  vp: { label: 'Victory points', publicKey: 'publicVP', privateKey: 'totalVP', suffix: 'VP' },
  roads: { label: 'Roads', publicKey: 'roads', suffix: 'roads' }
};

function valueFor(player, chart) {
  if (chart.privateKey && Number.isFinite(player?.[chart.privateKey])) return player[chart.privateKey];
  return Number(player?.[chart.publicKey]) || 0;
}

export default function ReplayChart({ points = [], players = [], chart = 'vp', onSeek }) {
  const definition = CHARTS[chart] || CHARTS.vp;
  const dimensions = { width: 720, height: 260, left: 44, right: 18, top: 18, bottom: 38 };
  const plotWidth = dimensions.width - dimensions.left - dimensions.right;
  const plotHeight = dimensions.height - dimensions.top - dimensions.bottom;
  const chartData = useMemo(() => {
    const maxTime = Math.max(1, ...points.map(point => Number(point.elapsedMs) || 0));
    const maxValue = Math.max(1, ...points.flatMap(point => (point.players || []).map(player => valueFor(player, definition))));
    const lines = players.map((player, playerIndex) => ({
      player,
      color: playerColor(player, playerIndex),
      points: points.map(point => {
        const metricPlayer = (point.players || []).find(candidate => candidate.id === player.id);
        const value = valueFor(metricPlayer, definition);
        return {
          seq: Number(point.seq) || 0,
          turn: point.turn,
          elapsedMs: Number(point.elapsedMs) || 0,
          value,
          x: dimensions.left + ((Number(point.elapsedMs) || 0) / maxTime) * plotWidth,
          y: dimensions.top + plotHeight - (value / maxValue) * plotHeight
        };
      })
    }));
    return { maxTime, maxValue, lines };
  }, [definition, players, plotHeight, plotWidth, points]);

  if (!points.length || !players.length) {
    return <div className="replay-empty-compact">No chart points were recorded for this match.</div>;
  }

  const tickCount = Math.min(6, chartData.maxValue + 1);
  const ticks = Array.from({ length: tickCount }, (_, index) => {
    const fraction = tickCount === 1 ? 0 : index / (tickCount - 1);
    return Math.round(chartData.maxValue * (1 - fraction));
  });

  return (
    <div className="replay-chart-wrap">
      <div className="replay-chart-legend" aria-label="Players">
        {chartData.lines.map(({ player, color }) => (
          <span key={player.id}><i style={{ backgroundColor: color }} />{player.name}</span>
        ))}
      </div>
      <svg className="replay-chart" viewBox={`0 0 ${dimensions.width} ${dimensions.height}`} role="img" aria-labelledby={`replay-chart-${chart}-title replay-chart-${chart}-desc`}>
        <title id={`replay-chart-${chart}-title`}>{definition.label} over the match</title>
        <desc id={`replay-chart-${chart}-desc`}>Each player’s recorded {definition.label.toLowerCase()}. Select a point to seek to that event.</desc>
        {ticks.map((tick, index) => {
          const y = dimensions.top + (index / Math.max(1, ticks.length - 1)) * plotHeight;
          return <g key={`${tick}-${index}`}>
            <line className="replay-chart-grid" x1={dimensions.left} x2={dimensions.width - dimensions.right} y1={y} y2={y} />
            <text className="replay-chart-axis" x={dimensions.left - 9} y={y + 4} textAnchor="end">{tick}</text>
          </g>;
        })}
        <line className="replay-chart-baseline" x1={dimensions.left} x2={dimensions.width - dimensions.right} y1={dimensions.top + plotHeight} y2={dimensions.top + plotHeight} />
        <text className="replay-chart-axis" x={dimensions.left} y={dimensions.height - 10}>Start</text>
        <text className="replay-chart-axis" x={dimensions.width - dimensions.right} y={dimensions.height - 10} textAnchor="end">{formatDuration(chartData.maxTime)}</text>
        {chartData.lines.map(({ player, color, points: playerPoints }) => (
          <g key={player.id}>
            <polyline
              className="replay-chart-line"
              fill="none"
              stroke={color}
              points={playerPoints.map(point => `${point.x},${point.y}`).join(' ')}
            />
            {playerPoints.filter((point, index) => index === 0 || index === playerPoints.length - 1 || point.value !== playerPoints[index - 1].value).map((point, index) => (
              <circle
                key={`${point.seq}-${index}`}
                className="replay-chart-point"
                cx={point.x}
                cy={point.y}
                r="5"
                fill={color}
                role="button"
                tabIndex="0"
                aria-label={`${player.name}, ${point.value} ${definition.suffix}, ${formatDuration(point.elapsedMs)}${point.turn == null ? '' : `, turn ${point.turn + 1}`}`}
                onClick={() => onSeek?.(point.seq)}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSeek?.(point.seq);
                  }
                }}
              />
            ))}
          </g>
        ))}
      </svg>
      <details className="replay-chart-table">
        <summary>Accessible data table</summary>
        <div className="replay-table-scroll">
          <table>
            <thead><tr><th scope="col">Time</th><th scope="col">Turn</th>{players.map(player => <th scope="col" key={player.id}>{player.name}</th>)}</tr></thead>
            <tbody>{points.map((point, index) => <tr key={`${point.seq}-${index}`}>
              <th scope="row"><button type="button" className="replay-text-button" onClick={() => onSeek?.(point.seq)}>{formatDuration(point.elapsedMs)}</button></th>
              <td>{point.turn == null ? '—' : point.turn + 1}</td>
              {players.map(player => {
                const metricPlayer = (point.players || []).find(candidate => candidate.id === player.id);
                return <td key={player.id}>{valueFor(metricPlayer, definition)}</td>;
              })}
            </tr>)}</tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
