import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import GameBoard from '../components/GameBoard';
import GameIcon from '../components/GameIcon';
import ReplayChart from './ReplayChart';
import ReplayTimeline from './ReplayTimeline.jsx';
import ReplayEventIcon from './ReplayEventIcon';
import { advanceReplayTime, eventAtTime, timeForSeq } from './timelineModel.js';
import { clampSeq, formatDuration, formatReplayDate, isTerminalRecording, replayHeaders, requestReplayJson, safeFilename, statusLabel } from './replayUtils';
import './ReplayPage.css';

const RecordedGameBoard = memo(GameBoard);
const RecordedChart = memo(ReplayChart);
const EMPTY = [];
const cardLabel = card => ({knight:'Knight',victoryPoint:'Victory point',roadBuilding:'Road building',yearOfPlenty:'Year of plenty',monopoly:'Monopoly'}[typeof card === 'string' ? card : card?.type] || 'Development card');
const INSPECTOR_TABS = [['events', 'Events', 'cards'], ['chat', 'Chat', 'chat'], ['facts', 'Details', 'compass']];
const friendlySummary = event => {
  if (event.type === 'chat') return `${event.actorName || 'Player'} spoke`;
  if (event.type === 'ready') return `${event.actorName || 'Player'} is ready`;
  if (event.type === 'advanceSetup') return `${event.actorName || 'Player'} finished placing`;
  return event.summary || 'Recorded event';
};

function EventList({ events, metrics, seq, onSeek }) {
  const currentRef = useRef(null);
  const phaseBySeq = useMemo(() => new Map(metrics.map(point => [point.seq, point.phase])), [metrics]);
  const boardStartSeq = useMemo(() => events.find(event => event.type === 'start')?.seq, [events]);
  const turnLabel = event => {
    const phase = phaseBySeq.get(event.seq);
    if (event.seq < boardStartSeq || phase === 'lobby' || phase === 'waiting') return 'Lobby';
    if (phase === 'setup') return 'Setup';
    return event.turn == null ? '' : `Turn ${event.turn + 1}`;
  };
  useEffect(() => {
    const row = currentRef.current;
    const pane = row?.closest('.replay-inspector-body');
    if (!pane) return;
    const bounds = pane.getBoundingClientRect(), item = row.getBoundingClientRect();
    if (item.top < bounds.top || item.bottom > bounds.bottom) pane.scrollTop += item.top - bounds.top - pane.clientHeight / 3;
  }, [seq, events]);
  if (!events.length) return <div className="replay-empty-compact">No recorded events yet.</div>;
  return <ol className="replay-event-list">
    {events.map(event => <li key={event.seq} className={`${event.seq === seq ? 'is-active' : ''} ${event.seq < seq ? 'is-passed' : ''}`} ref={event.seq === seq ? currentRef : null}>
      <button type="button" onClick={() => onSeek(event.seq)} aria-current={event.seq === seq ? 'step' : undefined}>
        <span className="replay-event-symbol"><ReplayEventIcon type={event.type} size={21} /></span>
        <span className="replay-event-copy"><strong>{friendlySummary(event)}</strong><small>{formatDuration(event.elapsedMs)}{turnLabel(event) ? ` · ${turnLabel(event)}` : ''}</small></span>
      </button>
    </li>)}
  </ol>;
}

function ChatList({ messages = [] }) {
  if (!messages.length) return <div className="replay-empty-compact">No chat had been recorded at this point.</div>;
  return <ol className="replay-chat-list">
    {messages.map((message, index) => <li key={message.id || message.sequence || index}>
      <div><strong>{message.playerName || message.actorName || message.author || 'Player'}</strong><time>{message.elapsedMs != null ? formatDuration(message.elapsedMs) : ''}</time></div>
      <p>{message.message || message.text || ''}</p>
    </li>)}
  </ol>;
}

function SnapshotFacts({ frame, event }) {
  const game = frame?.state?.gameState;
  const trade = frame?.state?.trade;
  const playerName = id => game?.players?.find(player => player.id === id)?.name || id;
  const bundle = quantities => Object.entries(quantities || {}).filter(([,count]) => count > 0).map(([resource,count]) => `${count} ${resource}`).join(', ');
  const facts = [
    ['Recorded event', frame?.seq ?? 0],
    ['Match time', formatDuration(frame?.elapsedMs)],
    ['Turn', game?.phase === 'setup' ? 'Setup' : ['lobby','waiting'].includes(game?.phase) ? 'Lobby' : (frame?.turn ?? game?.turnNumber) == null ? '—' : (frame?.turn ?? game?.turnNumber) + 1],
    ['Phase', game?.turnPhase || game?.phase || 'Waiting'],
    ['Current event', event?.summary || 'Initial state'],
    ['Dice', game?.diceRoll?.total ? `${game.diceRoll.die1} + ${game.diceRoll.die2} = ${game.diceRoll.total}` : 'Not rolled'],
    ['Bank development cards', Array.isArray(game?.devCardDeck) ? game.devCardDeck.length : Number.isFinite(game?.devCardDeck) ? game.devCardDeck : '—'],
    ['Room state', frame?.state?.paused ? 'Paused' : 'Running']
  ];
  if (trade) facts.push(['Trade', `${playerName(trade.from)} → ${playerName(trade.to)}`], ['Offered', bundle(trade.give)], ['Requested', bundle(trade.get)], ['Trade status', trade.status]);
  const labels = {vertexKey:'Settlement location',edgeKey:'Road location',hexKey:'Robber location',stealFromPlayerId:'Victim',resources:'Discarded',count:'Cards discarded',cardType:'Development card',resource:'Selected resource',giveResource:'Gave resource',giveAmount:'Amount given',getResource:'Received resource',message:'Chat message'};
  for (const [key,value] of Object.entries(event?.payload || {})) {
    if (!labels[key]) continue;
    const display = key === 'resources' ? bundle(value) : key === 'cardType' ? cardLabel(value) : key === 'stealFromPlayerId' ? playerName(value) : value;
    if (typeof display === 'string' || typeof display === 'number') facts.push([labels[key], display]);
  }
  return <dl className="replay-facts">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

export default function ReplayPage({ replayId, onBack, token, getToken }) {
  const [resolvedToken, setResolvedToken] = useState(token || null);
  const [perspective, setPerspective] = useState('public');
  const [recording, setRecording] = useState(null);
  const [perspectives, setPerspectives] = useState([]);
  const [frame, setFrame] = useState(null);
  const [events, setEvents] = useState([]);
  const [metrics, setMetrics] = useState([]);
  const [position, setPosition] = useState({ timeMs: 0, seq: 0 });
  const positionRef = useRef(position);
  const [readyKey, setReadyKey] = useState('');
  const [initialLoading, setInitialLoading] = useState(true);
  const [frameLoading, setFrameLoading] = useState(false);
  const [supplementLoading, setSupplementLoading] = useState(false);
  const [error, setError] = useState(null);
  const [supplementError, setSupplementError] = useState('');
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false);
  const [speed, setSpeed] = useState(1);
  const [skipIdle, setSkipIdle] = useState(false);
  const [inspectorTab, setInspectorTab] = useState('events');
  const [chartTab, setChartTab] = useState('vp');
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [showInspector, setShowInspector] = useState(false);
  const chartsButton = useRef(null);
  // Retain only camera coordinates across intentional privacy/motion remounts.
  const boardCamera = useRef(null);
  useEffect(() => {
    if (!showAnalysis) return undefined;
    const closeOnEscape = event => {
      if (event.key !== 'Escape') return;
      setShowAnalysis(false);
      chartsButton.current?.focus();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [showAnalysis]);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [seekGeneration, setSeekGeneration] = useState(0);
  const replayIdentityRef = useRef(replayId);
  const defaultPerspectiveRef = useRef(null);
  const initialBoardRef = useRef(false);
  const frameCache = useRef(new Map());

  const currentKey = `${replayId || ''}|${perspective}`;
  const lastSeq = Math.max(0, Number(recording?.lastSeq) || 0);
  const durationMs = Math.max(0, Number(recording?.elapsedMs) || 0);
  const { timeMs, seq } = position;
  const stopPlayback = useCallback(() => { playingRef.current = false; setPlaying(false); }, []);
  const movePosition = useCallback(next => { positionRef.current = next; setPosition(next); }, []);

  useEffect(() => {
    setResolvedToken(token || null);
  }, [replayId, token]);

  useEffect(() => {
    const controller = new AbortController();
    if (replayIdentityRef.current !== replayId) {
      replayIdentityRef.current = replayId;
      defaultPerspectiveRef.current = null;
      initialBoardRef.current = false;
      movePosition({timeMs:0,seq:0});
      if (perspective !== 'public') { setPerspective('public'); return undefined; }
    }
    const requested = positionRef.current;
    stopPlayback();
    setInitialLoading(true); setFrameLoading(false); setFrame(null); setRecording(null);
    setEvents([]); setMetrics([]); setReadyKey(''); setError(null); setSupplementError('');
    frameCache.current.clear();

    async function load() {
      let detailLoaded = false;
      try {
        const detail = await requestReplayJson(`/api/replays/${encodeURIComponent(replayId)}?at=${requested.seq}&perspective=${encodeURIComponent(perspective)}`, {token:resolvedToken,signal:controller.signal});
        if (controller.signal.aborted) return;
        if (!resolvedToken && getToken && detail.recording?.roomCode) {
          const credential = await getToken(detail.recording.roomCode);
          if (controller.signal.aborted) return;
          const nextToken = typeof credential === 'string' ? credential : credential?.playerToken || credential?.token || null;
          if (nextToken) { setResolvedToken(nextToken); return; }
        }
        const allowed = Array.isArray(detail.perspectives) ? detail.perspectives : [];
        if (defaultPerspectiveRef.current !== replayId) {
          defaultPerspectiveRef.current = replayId;
          const preferred = allowed.find(option => option.id === 'omniscient') || allowed.find(option => option.id !== 'public') || allowed[0];
          if (preferred && preferred.id !== perspective) { setPerspective(preferred.id); return; }
        }
        setPerspectives(allowed);
        setRecording(detail.recording); setFrame(detail); frameCache.current.set(detail.seq, detail);
        const next = {seq:clampSeq(detail.seq,detail.recording?.lastSeq),timeMs:Math.min(requested.timeMs,Math.max(0,Number(detail.recording?.elapsedMs)||0))};
        movePosition(next);
        setReadyKey(currentKey); setInitialLoading(false); setSupplementLoading(true); detailLoaded = true;
        const targetLastSeq = Math.max(0, Number(detail.recording?.lastSeq) || 0);
        const collected = [];
        let after = 0;
        while (after < targetLastSeq) {
          const page = await requestReplayJson(`/api/replays/${encodeURIComponent(replayId)}/events?after=${after}&limit=200&perspective=${encodeURIComponent(perspective)}`, {token:resolvedToken,signal:controller.signal});
          if (controller.signal.aborted) return;
          const pageEvents = (page.events || []).filter(event => event.seq <= targetLastSeq);
          const nextAfter = pageEvents.reduce((max,event) => Math.max(max,Number(event.seq)||0),after);
          if (!pageEvents.length || nextAfter <= after) throw new Error('The recorded timeline could not be fully loaded.');
          collected.push(...pageEvents); after = nextAfter;
        }
        if (controller.signal.aborted) return;
        setEvents(collected);
        // Open at board setup; the lobby remains available at the start of the timeline.
        if (!initialBoardRef.current) {
          initialBoardRef.current = true;
          const start = collected.find(event => event.type === 'start');
          if (start && positionRef.current.seq === 0 && positionRef.current.timeMs === 0) movePosition({seq:start.seq,timeMs:start.elapsedMs});
        }
        const metricData = await requestReplayJson(`/api/replays/${encodeURIComponent(replayId)}/metrics?perspective=${encodeURIComponent(perspective)}`, {token:resolvedToken,signal:controller.signal});
        if (!controller.signal.aborted) setMetrics(metricData.points || []);
      } catch (loadError) {
        if (controller.signal.aborted || loadError?.name === 'AbortError') return;
        if (!detailLoaded || [401,403].includes(loadError.status)) {
          setFrame(null); setEvents([]); setMetrics([]); frameCache.current.clear(); setError(loadError);
        } else setSupplementError(loadError.message);
        setInitialLoading(false);
      } finally {
        if (!controller.signal.aborted) setSupplementLoading(false);
      }
    }
    if (replayId) load();
    else { setError(Object.assign(new Error('Replay not found.'),{status:404})); setInitialLoading(false); }
    return () => controller.abort();
    // The view request owns its private cache; playback positions do not reload the timeline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayId, perspective, resolvedToken, getToken, movePosition, stopPlayback]);

  useEffect(() => {
    if (!recording || readyKey !== currentKey) return undefined;
    if (frame?.seq === seq) { setFrameLoading(false); return undefined; }
    const cached = frameCache.current.get(seq);
    if (cached) { setFrame(cached); setFrameLoading(false); return undefined; }
    const controller = new AbortController();
    setFrameLoading(true);
    requestReplayJson(`/api/replays/${encodeURIComponent(replayId)}?at=${seq}&perspective=${encodeURIComponent(perspective)}`, {token:resolvedToken,signal:controller.signal})
      .then(detail => {
        if (controller.signal.aborted) return;
        frameCache.current.set(detail.seq,detail);
        if (frameCache.current.size > 80) frameCache.current.delete(frameCache.current.keys().next().value);
        setFrame(detail);
      })
      .catch(loadError => {
        if (controller.signal.aborted || loadError?.name === 'AbortError') return;
        stopPlayback(); setSupplementError(loadError.message);
        if ([401,403].includes(loadError.status)) { setFrame(null); setEvents([]); setMetrics([]); frameCache.current.clear(); setError(loadError); }
      })
      .finally(() => { if (!controller.signal.aborted) setFrameLoading(false); });
    return () => controller.abort();
  }, [currentKey, frame?.seq, perspective, readyKey, recording, replayId, resolvedToken, seekGeneration, seq, stopPlayback]);

  const seekTime = useCallback(value => {
    stopPlayback(); initialBoardRef.current = true; setSupplementError('');
    const target = Math.max(0,Math.min(durationMs,Number(value)||0));
    movePosition({timeMs:target,seq:eventAtTime(events,target)?.seq || 0});
    setSeekGeneration(value => value+1);
  }, [durationMs,events,movePosition,stopPlayback]);
  const seekEvent = useCallback(value => {
    stopPlayback(); initialBoardRef.current = true; setSupplementError('');
    const target = clampSeq(value,lastSeq);
    movePosition({timeMs:timeForSeq(events,target),seq:target});
    setSeekGeneration(value => value+1);
  }, [events,lastSeq,movePosition,stopPlayback]);

  useEffect(() => {
    if (!playing || supplementLoading || readyKey !== currentKey || !events.length) return undefined;
    playingRef.current = true;
    let previous = performance.now(), painted = previous, animation;
    const tick = now => {
      if (!playingRef.current) return;
      const prior = positionRef.current;
      const nextTime = advanceReplayTime({timeMs:prior.timeMs,deltaMs:Math.max(0,now-previous),speed,durationMs,events,skipIdle});
      previous = now;
      const next = {timeMs:nextTime,seq:eventAtTime(events,nextTime)?.seq || 0};
      positionRef.current = next;
      if (next.seq !== prior.seq || now-painted >= 50 || nextTime >= durationMs) { setPosition(next); painted=now; }
      if (nextTime >= durationMs) { stopPlayback(); return; }
      animation = requestAnimationFrame(tick);
    };
    animation = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(animation); playingRef.current=false; };
  }, [currentKey,durationMs,events,playing,readyKey,skipIdle,speed,stopPlayback,supplementLoading]);

  const togglePlayback = useCallback(() => {
    if (playingRef.current) { stopPlayback(); setPosition(positionRef.current); return; }
    if (positionRef.current.timeMs >= durationMs) {
      movePosition({timeMs:0,seq:0}); setSeekGeneration(value => value+1);
    }
    setPlaying(true);
  }, [durationMs,movePosition,stopPlayback]);
  const changePerspective = useCallback(next => {
    if (next === perspective || !perspectives.some(option => option.id === next)) return;
    stopPlayback(); setPosition(positionRef.current); setFrame(null); setEvents([]); setMetrics([]);
    frameCache.current.clear(); setInitialLoading(true); setSeekGeneration(value => value+1); setPerspective(next);
  }, [perspective,perspectives,stopPlayback]);

  const exportReplay = async () => {
    setExporting(true); setExportError('');
    try {
      const response = await fetch(`/api/replays/${encodeURIComponent(replayId)}/export?perspective=${encodeURIComponent(perspective)}&gzip=1`, {headers:replayHeaders(resolvedToken)});
      if (!response.ok) throw new Error(`Export failed (${response.status}).`);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href=url; link.download=`${safeFilename(recording?.title || replayId)}.jsonl.gz`;
      document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    } catch (downloadError) { setExportError(downloadError.message); }
    finally { setExporting(false); }
  };

  const eventBySeq = useMemo(() => new Map(events.map(event => [event.seq,event])),[events]);
  const displayedEvent = eventBySeq.get(frame?.seq) || null;
  const inspector = useMemo(() => <div className="replay-game-inspector">
    <div className="replay-inspector-tabs" role="tablist" aria-label="Replay inspector">
      {INSPECTOR_TABS.map(([id,label,icon]) => <button key={id} type="button" role="tab" aria-selected={inspectorTab === id} onClick={() => setInspectorTab(id)}><GameIcon name={icon} size={15}/>{label}</button>)}
    </div>
    <div className="replay-inspector-body" role="tabpanel">
      {inspectorTab === 'events' && <EventList events={events} metrics={metrics} seq={frame?.seq ?? 0} onSeek={seekEvent}/>}
      {inspectorTab === 'chat' && <ChatList messages={frame?.state?.chat || EMPTY}/>}
      {inspectorTab === 'facts' && <SnapshotFacts frame={frame} event={displayedEvent}/>}
    </div>
  </div>, [displayedEvent,events,metrics,frame,inspectorTab,seekEvent]);
  const allowedSeatIds = useMemo(() => perspectives.filter(option => !['public','omniscient'].includes(option.id)).map(option => option.id),[perspectives]);
  const resetKey = `${currentKey}:${seekGeneration}`;
  const replay = useMemo(() => ({boardCamera,perspective,allowedSeatIds,onSelectPlayer:changePerspective,inspector:showInspector ? inspector : null,resetKey,playing,speed}),[perspective,allowedSeatIds,changePerspective,inspector,showInspector,resetKey,playing,speed]);
  const gameState = useMemo(() => frame?.state?.gameState ? {...frame.state.gameState,myIndex:perspective === 'omniscient' ? -1 : frame.state.gameState.myIndex ?? -1} : null,[frame?.state?.gameState,perspective]);
  const players = recording?.players || EMPTY;
  const activePerspective = perspectives.find(option => option.id === perspective);

  if (initialLoading) return <main className="replay-route replay-route-centered" aria-busy="true"><div className="replay-loading"><i/><strong>Loading replay</strong></div></main>;
  if (error) return <main className="replay-route replay-route-centered"><section className="replay-error" role="alert"><h1>{error.status === 404 ? 'Replay not found' : 'Replay unavailable'}</h1><p>{error.message}</p>{onBack && <button type="button" className="replay-primary-button" onClick={onBack}>Back to Catan</button>}</section></main>;

  return <main className={`replay-route replay-player-page ${showInspector ? 'show-replay-inspector' : ''}`}>
    <header className="replay-viewer-toolbar">
      {onBack && <button type="button" className="replay-back-button" onClick={onBack}>Back</button>}
      <div className="replay-viewer-title"><strong>{recording?.title || 'Match replay'}</strong><span title={formatReplayDate(recording?.startedAt)}>{statusLabel(recording)}{recording?.sample ? ' · Sample' : ''}</span></div>
      <div className="replay-view-actions">
        {perspectives.some(option => option.id === 'omniscient') && <button type="button" className="replay-view-button" aria-pressed={perspective === 'omniscient'} onClick={() => changePerspective('omniscient')}><GameIcon name="players" size={17}/><span>Omniscient</span></button>}
        {perspective !== 'omniscient' && <span className="replay-view-name">{perspective === 'public' ? 'Spectator' : `Viewing ${activePerspective?.label || 'player'}`}</span>}
        <button type="button" className="replay-details-toggle" aria-expanded={showInspector} onClick={() => setShowInspector(value => !value)}><GameIcon name="chat" size={16}/><span>Events & chat</span></button>
        <button ref={chartsButton} type="button" aria-expanded={showAnalysis} onClick={() => setShowAnalysis(value => !value)}><GameIcon name="trophy" size={16}/><span>Charts</span></button>
        <button type="button" onClick={exportReplay} disabled={exporting}>{exporting ? 'Exporting…' : 'Export'}</button>
      </div>
    </header>
    {(recording?.partial || !isTerminalRecording(recording)) && <div className="replay-privacy-note" role="note">{recording?.partial ? 'Recording begins partway through this match.' : 'This match can resume. Only your seat’s private perspective is available.'}</div>}
    {(supplementError || exportError) && <div className="replay-inline-error" role="status">{supplementError || exportError}</div>}
    <div className="replay-game-stage" aria-busy={frameLoading}>
      {gameState?.hexes && Object.keys(gameState.hexes).length ? <RecordedGameBoard key={resetKey} replay={replay}
        gameState={gameState} gameCode={replayId} playerId={gameState.players?.[gameState.myIndex]?.id || null}
        chatMessages={frame?.state?.chat || EMPTY} slots={frame?.state?.slots || EMPTY}
        rollEvent={frame?.state?.lastRoll} cardEvents={frame?.state?.cardEvents || EMPTY} paused
      /> : <div className="replay-opening"><GameIcon name="players" size={46}/><h1>The lobby</h1><p>{players.map(player => player.name).join(' · ')}</p><span>Play through the lobby or jump to board setup.</span><button type="button" disabled={!events.some(event => event.type === 'start')} onClick={() => seekEvent(events.find(event => event.type === 'start')?.seq || 0)}>Board setup</button></div>}
      {frameLoading && <span className="replay-frame-status" role="status">Loading moment…</span>}
    </div>
    {showAnalysis && <section className="replay-analysis replay-analysis-overlay" aria-label="Match charts">
      <header><h2>Match progress</h2>
      <div className="replay-chart-tabs" role="group" aria-label="Match chart">
        <button type="button" aria-pressed={chartTab === 'vp'} onClick={() => setChartTab('vp')}><GameIcon name="trophy" size={17}/>Victory points</button>
        <button type="button" aria-pressed={chartTab === 'roads'} onClick={() => setChartTab('roads')}><GameIcon name="road" size={17}/>Roads</button>
      </div>
      <button type="button" aria-label="Close charts" onClick={() => {setShowAnalysis(false);chartsButton.current?.focus();}}><GameIcon name="close" size={18}/></button></header>
      <RecordedChart key={chartTab} points={metrics} players={players} chart={chartTab} timeMs={timeMs} seq={seq} onSeek={seekEvent}/>
    </section>}
    <ReplayTimeline events={events} metrics={metrics} players={players} durationMs={durationMs} timeMs={timeMs} playing={playing} speed={speed} skipIdle={skipIdle}
      disabled={supplementLoading || !events.length} onSeekTime={seekTime} onSeekEvent={seekEvent} onTogglePlay={togglePlayback} onSpeedChange={setSpeed} onSkipIdleChange={setSkipIdle}/>
  </main>;
}
