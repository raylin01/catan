import { useEffect, useMemo, useRef, useState } from 'react';
import ReplayEventIcon from './ReplayEventIcon';
import { formatDuration } from './replayUtils';
import {
  buildTimelineMarkers,
  buildTurnBands,
  eventAtTime,
  groupTimelineMarkers
} from './timelineModel.js';
import './ReplayTimeline.css';

const SPEEDS = [0.5, 1, 2, 4, 8];
const MARKER_PRIORITY = ['win', 'longest-road', 'largest-army', 'robber', 'victory-point', 'turn'];

function markerSeek(marker, onSeekEvent, onSeekTime) {
  if (onSeekEvent) onSeekEvent(marker.seq);
  else onSeekTime?.(marker.timeMs);
}

export default function ReplayTimeline({
  events = [],
  metrics = [],
  players = [],
  durationMs = 0,
  timeMs = 0,
  playing = false,
  speed = 1,
  skipIdle = false,
  disabled = false,
  onSeekTime,
  onSeekEvent,
  onTogglePlay,
  onSpeedChange,
  onSkipIdleChange
}) {
  const [openGroup, setOpenGroup] = useState(null);
  const [markerRailWidth, setMarkerRailWidth] = useState(720);
  const timelineRef = useRef(null);
  const markerRailRef = useRef(null);
  const markerButtonRefs = useRef(new Map());
  const duration = Math.max(0, Number(durationMs) || 0);
  const currentTime = Math.min(duration, Math.max(0, Number(timeMs) || 0));
  const atEnd = duration > 0 && currentTime >= duration;
  const currentEvent = useMemo(() => eventAtTime(events, currentTime), [events, currentTime]);
  const markers = useMemo(() => buildTimelineMarkers(events, metrics, players), [events, metrics, players]);
  const markerGroups = useMemo(() => groupTimelineMarkers(markers, duration, {
    bucketCount: Math.max(1, Math.floor(markerRailWidth / 48))
  }), [duration, markerRailWidth, markers]);
  const turnBands = useMemo(() => buildTurnBands(metrics, players, duration), [duration, metrics, players]);

  useEffect(() => {
    if (!openGroup) return undefined;
    const close = event => {
      if (event.key === 'Escape' || (event.type === 'pointerdown' && !timelineRef.current?.contains(event.target))) {
        setOpenGroup(null);
        if (event.key === 'Escape') window.requestAnimationFrame(() => markerButtonRefs.current.get(openGroup)?.focus());
      }
    };
    document.addEventListener('keydown', close);
    document.addEventListener('pointerdown', close);
    return () => {
      document.removeEventListener('keydown', close);
      document.removeEventListener('pointerdown', close);
    };
  }, [openGroup]);

  useEffect(() => {
    if (openGroup && !markerGroups.some(group => group.id === openGroup)) setOpenGroup(null);
  }, [markerGroups, openGroup]);

  useEffect(() => {
    const rail = markerRailRef.current;
    if (!rail) return undefined;
    const updateWidth = () => setMarkerRailWidth(Math.max(1, rail.getBoundingClientRect().width));
    updateWidth();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateWidth);
      return () => window.removeEventListener('resize', updateWidth);
    }
    const observer = new ResizeObserver(updateWidth);
    observer.observe(rail);
    return () => observer.disconnect();
  }, []);

  const turnStarts = turnBands.length
    ? turnBands
    : markers.filter(marker => marker.type === 'turn').map(marker => ({ ...marker, startMs: marker.timeMs }));
  const previousTurn = [...turnStarts].reverse().find(turn => turn.startMs < currentTime - 1);
  const nextTurn = turnStarts.find(turn => turn.startMs > currentTime + 1);

  const seekTurn = turn => {
    if (!turn) return;
    if (onSeekEvent && Number.isFinite(turn.seq)) onSeekEvent(turn.seq);
    else onSeekTime?.(turn.startMs);
  };

  const togglePlayback = () => {
    onTogglePlay?.();
  };

  return <section className="replay-timeline" aria-label="Replay timeline" ref={timelineRef}>
    <div className="replay-timeline-axis">
      <div className="replay-marker-rail" aria-label="Important moments" ref={markerRailRef}>
        {markerGroups.map(group => {
          const primary = MARKER_PRIORITY.map(type => group.markers.find(marker => marker.type === type)).find(Boolean) || group.markers[0];
          const expanded = openGroup === group.id;
          const single = group.markers.length === 1;
          const label = single ? primary.label : `${primary.label} · ${group.markers.length} moments`;
          const edgeClass = group.position < 20 ? 'is-edge-start' : group.position > 80 ? 'is-edge-end' : '';
          return <div className={`replay-marker-anchor ${edgeClass}`} key={group.id} style={{ left: `${group.position}%` }}>
            <button
              ref={node => node ? markerButtonRefs.current.set(group.id, node) : markerButtonRefs.current.delete(group.id)}
              type="button"
              className={`replay-marker-button replay-marker-button--${primary.type}`}
              style={{ '--marker-color': primary.color || undefined }}
              title={label}
              aria-label={label}
              aria-expanded={single ? undefined : expanded}
              aria-haspopup={single ? undefined : 'dialog'}
              onClick={() => single ? markerSeek(primary, onSeekEvent, onSeekTime) : setOpenGroup(expanded ? null : group.id)}
              disabled={disabled}
            >
              <ReplayEventIcon type={primary.type} size={15} />
              {!single && <span>{group.markers.length}</span>}
            </button>
            {expanded && !single && <div className="replay-marker-popover" role="dialog" aria-label={`Moments near ${formatDuration(group.timeMs)}`}>
              {group.markers.map(marker => <button key={marker.id} type="button" onClick={() => {
                markerSeek(marker, onSeekEvent, onSeekTime);
                setOpenGroup(null);
                window.requestAnimationFrame(() => markerButtonRefs.current.get(group.id)?.focus());
              }}>
                <ReplayEventIcon type={marker.type} size={16} />
                <span><strong>{marker.label}</strong><small>{formatDuration(marker.timeMs)} · Event {marker.seq}</small></span>
              </button>)}
            </div>}
          </div>;
        })}
      </div>

      <div className="replay-turn-bands" aria-label="Turns">
        {turnBands.map(band => {
          const left = duration ? (band.startMs / duration) * 100 : 0;
          const width = duration ? ((band.endMs - band.startMs) / duration) * 100 : 0;
          return <button
            key={band.id}
            type="button"
            style={{ left: `${left}%`, width: `${Math.max(0.15, width)}%`, '--turn-color': band.color || undefined }}
            title={band.label}
            aria-label={`Seek to ${band.label}`}
            onClick={() => seekTurn(band)}
            disabled={disabled}
          />;
        })}
      </div>

      <label className="replay-time-range">
        <span className="replay-visually-hidden">Replay time</span>
        <input
          type="range"
          min="0"
          max={Math.max(0, duration)}
          step="100"
          value={currentTime}
          disabled={disabled || duration <= 0}
          onChange={event => onSeekTime?.(Number(event.target.value))}
          aria-valuetext={`${formatDuration(currentTime)} of ${formatDuration(duration)}${currentEvent ? `, event ${currentEvent.seq}` : ''}`}
        />
      </label>
      <time className="replay-time-readout" dateTime={`PT${Math.floor(currentTime / 1000)}S`}>{formatDuration(currentTime)} <span>/ {formatDuration(duration)}</span></time>
    </div>

    <div className="replay-timeline-controls">
      <div className="replay-turn-controls" aria-label="Turn navigation">
        <button type="button" onClick={() => seekTurn(previousTurn)} disabled={disabled || !previousTurn} aria-label="Previous turn" title="Previous turn"><ReplayEventIcon type="previous" size={17} /><span>Turn</span></button>
        <button type="button" className="replay-timeline-play" onClick={togglePlayback} disabled={disabled || duration <= 0} aria-label={playing ? 'Pause replay' : atEnd ? 'Restart replay' : 'Play replay'}>
          <ReplayEventIcon type={playing ? 'pause' : atEnd ? 'restart' : 'play'} size={18} />
          <span>{playing ? 'Pause' : atEnd ? 'Restart' : 'Play'}</span>
        </button>
        <button type="button" onClick={() => seekTurn(nextTurn)} disabled={disabled || !nextTurn} aria-label="Next turn" title="Next turn"><span>Turn</span><ReplayEventIcon type="next" size={17} /></button>
      </div>

      <div className="replay-timeline-options">
        <label><span>Speed</span><select value={speed} onChange={event => onSpeedChange?.(Number(event.target.value))} disabled={disabled}>{SPEEDS.map(value => <option key={value} value={value}>{value}×</option>)}</select></label>
        <label className="replay-idle-toggle"><input type="checkbox" checked={skipIdle} onChange={event => onSkipIdleChange?.(event.target.checked)} disabled={disabled} /><span>Skip idle</span></label>
      </div>
    </div>
  </section>;
}
