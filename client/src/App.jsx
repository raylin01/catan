import {AiControls, ChatModelFields} from './components/AiControls';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import RoomLobby from './RoomLobby';
import WatchPage from './sharing/WatchPage';
import RoomShare,{EndRoomControl,AgentInstructions} from './sharing/RoomShare';
import GameBoard from './components/GameBoard';
import RoomTradePanel from './components/RoomTradePanel';
import ReplayPage from './replay/ReplayPage';
import ReplayArchive from './replay/ReplayArchive';
import {createObservationBoundary, isOlderObservation} from './presentation/observationBoundary';
import './App.css';
import './room.css';

const SESSION_STORAGE_KEY = 'catanRoomSession';
const POLL_INTERVAL = 1000;

function readStoredSession() {
  if (typeof window === 'undefined') return null;
  try {
    const value = JSON.parse(window.localStorage.getItem(SESSION_STORAGE_KEY) || 'null');
    if (value?.rooms && typeof value.rooms === 'object') {
      const activeCode = value.activeCode ? String(value.activeCode).toUpperCase() : null;
      const active = activeCode ? value.rooms[activeCode] : null;
      if (active?.hostToken || active?.playerToken) return { ...active, code: activeCode, rooms: value.rooms };
      return { code: null, hostToken: null, playerToken: null, rooms: value.rooms };
    }
    if (!value?.code || (!value.hostToken && !value.playerToken)) return null;
    const code = String(value.code).toUpperCase();
    const active = {
      code,
      hostToken: value.hostToken || null,
      playerToken: value.playerToken || null,
      playerRole: value.playerRole || null,
      seatId: value.seatId || null,
      generation: Number.isInteger(value.generation) ? value.generation : 0,
      displayName: value.displayName || ''
    };
    return { ...active, rooms: { [code]: active } };
  } catch {
    return null;
  }
}

function saveSession(session) {
  if (typeof window === 'undefined') return;
  const rooms = { ...(session?.rooms || {}) };
  if (session?.code && (session.hostToken || session.playerToken)) {
    const { rooms: _rooms, ...active } = session;
    rooms[session.code] = active;
  }
  if (!Object.keys(rooms).length) {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
    activeCode: session?.code || null,
    rooms
  }));
}

function makeRequestId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function requestJson(path, { method = 'GET', token, body, headers: extraHeaders } = {}) {
  const headers = { Accept: 'application/json', ...(extraHeaders || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch {
    const error = new Error('The room service could not be reached.');
    error.status = 0;
    throw error;
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok || data?.success === false) {
    const error = new Error(data?.error || `Request failed (${response.status})`);
    error.status = data?.statusCode || response.status;
    throw error;
  }

  return data;
}

function getToken(response) {
  return response?.token || null;
}

function getCode(response, fallback = '') {
  return String(response?.code || fallback).toUpperCase();
}

function normalizeGameState(snapshot) {
  if (!snapshot?.gameState) return null;
  const state = { ...snapshot.gameState };
  const trade = snapshot.trade;

  if (!trade) {
    state.tradeOffer = null;
    return state;
  }

  const from = state.players?.findIndex(player => player.id === trade.from) ?? -1;
  const to = state.players?.findIndex(player => player.id === trade.to) ?? -1;
  state.tradeOffer = {
    id: trade.id,
    status: trade.status,
    from,
    to,
    offer: trade.give || {},
    request: trade.get || {}
  };
  return state;
}

function readRequestedRoom() {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('room')?.trim().toUpperCase() || '';
}

function createRoomAdapter() {
  let context = {
    snapshot: null,
    gameState: null,
    seatId: null,
    sendCommand: async () => ({ success: false, error: 'Room is not ready' })
  };
  const listeners = new Map();

  const emitEvent = (event, payload) => {
    listeners.get(event)?.forEach(listener => listener(payload));
  };

  const playersOnHex = hexKey => {
    const actions = context.snapshot?.legalActions || [];
    const ids = [...new Set(
      actions
        .filter(action => action.type === 'moveRobber' && action.payload?.hexKey === hexKey)
        .map(action => action.payload?.stealFromPlayerId)
        .filter(Boolean)
    )];
    return ids
      .map(id => context.gameState?.players?.find(player => player.id === id))
      .filter(Boolean)
      .map(player => ({
        id: player.id,
        name: player.name,
        hasResources: typeof player.resources === 'object'
          ? Object.values(player.resources).some(amount => amount > 0)
          : Number(player.resources) > 0
      }));
  };

  const commandFor = (event, payload = {}) => {
    switch (event) {
      case 'rollDice': return { type: 'rollDice', payload: {} };
      case 'chooseRobberCard': return { type: 'chooseRobberCard', payload: { cardId: payload.cardId } };
      case 'discardCards': return { type: 'discardCards', payload: { resources: payload.resources } };
      case 'moveRobber': return { type: 'moveRobber', payload: {
        hexKey: payload.hexKey,
        stealFromPlayerId: payload.stealFromPlayerId || null
      } };
      case 'placeSettlement': return { type: 'placeSettlement', payload: { vertexKey: payload.vertexKey } };
      case 'placeRoad': return { type: 'placeRoad', payload: { edgeKey: payload.edgeKey } };
      case 'advanceSetup': return { type: 'advanceSetup', payload: {} };
      case 'upgradeToCity': return { type: 'upgradeToCity', payload: { vertexKey: payload.vertexKey } };
      case 'buyDevCard': return { type: 'buyDevCard', payload: {} };
      case 'playDevCard': return { type: 'playDevCard', payload: {
        cardType: payload.cardType,
        params: payload.params || {}
      } };
      case 'yearOfPlentyPick': return { type: 'yearOfPlentyPick', payload: { resource: payload.resource } };
      case 'bankTrade': return { type: 'bankTrade', payload: {
        giveResource: payload.giveResource,
        giveAmount: payload.giveAmount,
        getResource: payload.getResource
      } };
      case 'finishFreeRoads': return { type: 'finishFreeRoads', payload: {} };
      case 'endTurn': return { type: 'endTurn', payload: {} };
      case 'chatMessage': return { type: 'chat', payload: { message: payload.message } };
      default: return null;
    }
  };

  return {
    configure(nextContext) {
      context = { ...context, ...nextContext };
    },
    on(event, listener) {
      const current = listeners.get(event) || new Set();
      current.add(listener);
      listeners.set(event, current);
    },
    off(event, listener) {
      const current = listeners.get(event);
      if (!current) return;
      if (listener) current.delete(listener);
      else current.clear();
    },
    emit(event, payload, callback) {
      let commandPayload = payload;
      let done = callback;
      if (typeof payload === 'function') {
        done = payload;
        commandPayload = {};
      }

      if (event === 'getPlayersOnHex') {
        done?.({ success: true, players: playersOnHex(commandPayload?.hexKey) });
        return;
      }

      if (['proposeTrade', 'respondToTrade', 'cancelTrade'].includes(event)) {
        done?.({ success: false, error: 'Use the room trade panel for player trades.' });
        return;
      }

      if (event === 'startGame' || event === 'shuffleBoard' || event === 'endSpecialBuild') {
        done?.({ success: false, error: 'This action is controlled from the room session.' });
        return;
      }

      const command = commandFor(event, commandPayload || {});
      if (!command) {
        done?.({ success: false, error: `Unsupported room action: ${event}` });
        return;
      }

      context.sendCommand(command.type, command.payload).then(result => {
        done?.(result);
        if (result?.success && event === 'rollDice' && result.roll) {
          emitEvent('diceRolled', { roll: result.roll, playerId: context.seatId });
        }
      });
    }
  };
}

function HostToolbar({ code,  paused, busy, onCommand, slots = [], providers = [], phase }) {
  const [seatDrafts, setSeatDrafts] = useState({});
  const gameEnded = phase === 'finished';

  useEffect(() => {
    setSeatDrafts(previous => {
      const next = {};
      slots.forEach(slot => {
        next[slot.id] = previous[slot.id] || {
          kind: slot.kind,
          provider: slot.provider || providers[0]?.id || '',
          model: slot.model || '',
          chatEnabled: slot.chatEnabled !== false, chatModel: slot.chatModel || '', chatReasoning: slot.chatReasoning || ''
        };
      });
      return next;
    });
  }, [providers, slots]);

  const updateSeatDraft = (seatId, field, value) => {
    setSeatDrafts(previous => ({
      ...previous,
      [seatId]: { ...previous[seatId], [field]: value }
    }));
  };

  const updateController = async slot => {
    const draft = seatDrafts[slot.id] || {
      kind: slot.kind,
      provider: slot.provider || providers[0]?.id || '',
      model: slot.model || '',
          chatEnabled: slot.chatEnabled !== false, chatModel: slot.chatModel || '', chatReasoning: slot.chatReasoning || ''
    };
    await onCommand('removeController', {
      seatId: slot.id,
      kind: draft.kind,
      ...(draft.kind === 'ai'
        ? { provider: draft.provider || providers[0]?.id, model: draft.model.trim() || undefined, chatEnabled: draft.provider !== 'mcp' && draft.chatEnabled !== false, chatModel: draft.chatModel?.trim() || null, chatReasoning: draft.chatReasoning || null }
        : {})
    });
    setSeatDrafts(previous => ({
      ...previous,
      [slot.id]: { ...draft, provider: draft.provider || providers[0]?.id || '' }
    }));
  };

  return (
    <details className="room-host-toolbar">
      <summary>Host controls</summary>
      <div className="room-host-toolbar-header">
        <div>
          <strong>{gameEnded ? 'Game ended' : 'Host controls'}</strong>
          <p>{gameEnded ? 'This game has ended.' : paused ? 'The room is paused.' : 'The room is live.'}</p>
        </div>
        {!gameEnded && (
          <div className="room-host-toolbar-actions">
            <button
              type="button"
              className="room-secondary-button"
              onClick={() => onCommand(paused ? 'resume' : 'pause')}
              disabled={busy}
            >
              {paused ? 'Resume room' : 'Pause room'}
            </button>
            <EndRoomControl onEnd={()=>onCommand('endGame')} busy={busy}/>
          </div>
        )}
      </div>
      <details className="room-host-roster">
        <summary>Manage seats</summary>
        <div className="room-host-seat-list">
          {slots.length === 0 && <p className="room-muted">Seat information is not available yet.</p>}
          {slots.map((slot, index) => {
            const draft = seatDrafts[slot.id] || {
              kind: slot.kind,
              provider: slot.provider || providers[0]?.id || '',
              model: slot.model || '',
          chatEnabled: slot.chatEnabled !== false, chatModel: slot.chatModel || '', chatReasoning: slot.chatReasoning || ''
            };
            const providerName = providers.find(provider => provider.id === slot.provider)?.name || slot.provider;
            return (
              <div className="room-host-seat" key={slot.id}>
                <div className="room-host-seat-main">
                  <strong>{slot.name || `Seat ${index + 1}`}</strong>
                  <p>
                    {slot.occupied ? 'Occupied' : 'Vacant'} · {slot.connected ? 'Connected' : 'Waiting'}
                    {slot.kind === 'ai' ? ` · ${providerName || 'AI'}${slot.model ? ` · ${slot.model}` : ''}` : ' · Human'}
                  </p>
                </div>
                {slot.kind === 'ai' && !slot.occupied && <AgentInstructions key={`${slot.id}:${slot.provider}:${slot.model}`} code={code} slot={slot}/>}
                <AiControls slot={slot} onCommand={onCommand} busy={busy}/>
                <div className="room-host-seat-controls">
                  <label>
                    Controller
                    <select
                      value={draft.kind}
                      onChange={event => updateSeatDraft(slot.id, 'kind', event.target.value)}
                    >
                      <option value="human">Human</option>
                      <option value="ai">AI</option>
                    </select>
                  </label>
                  {draft.kind === 'ai' && (
                    <>
                      <label>
                        Provider
                        <select
                          value={draft.provider}
                          onChange={event => updateSeatDraft(slot.id, 'provider', event.target.value)}
                          disabled={!providers.length}
                        >
                          {!providers.length && <option value="">Loading connectors</option>}
                          {providers.map(provider => (
                            <option key={provider.id} value={provider.id}>{provider.name || provider.id}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Model
                        <input
                          type="text"
                          value={draft.model}
                          onChange={event => updateSeatDraft(slot.id, 'model', event.target.value)}
                          placeholder="Configured by controller"
                          maxLength={40}
                        />
                      </label>
                      {draft.provider !== 'mcp' && <ChatModelFields draft={draft} onChange={(field,value)=>updateSeatDraft(slot.id,field,value)}/>}
                    </>
                  )}
                  <button
                    type="button"
                    className={slot.occupied ? 'room-danger-button' : 'room-secondary-button'}
                    onClick={() => updateController(slot)}
                    disabled={busy || (draft.kind === 'ai' && !providers.length)}
                  >
                    {slot.occupied ? 'Release and set' : 'Set controller'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </details>
    </details>
  );
}

function LiveClaimSeatForm({ code, defaultName = '', vacantHumanSlots = [], busy, onClaim }) {
  const [name, setName] = useState(defaultName);
  const [seatId, setSeatId] = useState('');
  const selectedSeatId = vacantHumanSlots.some(slot => slot.id === seatId)
    ? seatId
    : vacantHumanSlots[0]?.id || '';

  useEffect(() => {
    if (!vacantHumanSlots.some(slot => slot.id === seatId)) {
      setSeatId(vacantHumanSlots[0]?.id || '');
    }
  }, [seatId, vacantHumanSlots]);

  const submit = async event => {
    event.preventDefault();
    if (!name.trim() || !selectedSeatId) return;
    await onClaim({ code, name: name.trim(), role: 'human', seatId: selectedSeatId });
  };

  return (
    <form className="room-claim-form" onSubmit={submit}>
      <div>
        <h3>Claim a human seat</h3>
        <p>This room has a vacant human seat. Claim one to play.</p>
      </div>
      <label>
        Name
        <input
          type="text"
          value={name}
          onChange={event => setName(event.target.value)}
          maxLength={40}
          required
        />
      </label>
      <label>
        Seat
        <select value={selectedSeatId} onChange={event => setSeatId(event.target.value)} required>
          {vacantHumanSlots.map((slot, index) => (
            <option key={slot.id} value={slot.id}>{slot.name || `Seat ${index + 1}`}</option>
          ))}
        </select>
      </label>
      <button type="submit" className="room-primary-button" disabled={busy || !selectedSeatId}>
        {busy ? 'Claiming…' : 'Claim seat'}
      </button>
    </form>
  );
}


function LiveApp() {
  const [session, setSession] = useState(readStoredSession);
  const [requestedRoomCode, setRequestedRoomCode] = useState(readRequestedRoom);
  const [snapshot, setSnapshot] = useState(null);
  const [presentationEpoch, setPresentationEpoch] = useState(0);
  const observationBoundary = useRef(null);
  observationBoundary.current ||= createObservationBoundary();
  const [hostSnapshot, setHostSnapshot] = useState(null);
  const [providers, setProviders] = useState([]);
  const activeSession = requestedRoomCode && session?.code !== requestedRoomCode ? null : session;
  const [loading, setLoading] = useState(Boolean(activeSession?.code));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const adapter = useMemo(() => createRoomAdapter(), []);
  const commandSequence = useRef(0);
  const snapshotRef = useRef(null);
  const hostSnapshotRef = useRef(null);

  const observationContext = useRef(null);
  const connectionError = useRef(null);
  const acceptSnapshot = useCallback((next, code, token) => {
    if (observationContext.current?.code !== code || observationContext.current?.token !== token) return;
    if (isOlderObservation(snapshotRef.current, next)) return;
    const recoveredError = connectionError.current;
    if (recoveredError) setError(current => current === recoveredError ? null : current);
    connectionError.current = null;
    setPresentationEpoch(observationBoundary.current.accept());
    snapshotRef.current = next;
    setSnapshot(next);
  }, []);

  const activeToken = activeSession?.playerToken || activeSession?.hostToken || null;
  observationContext.current = {code:activeSession?.code, token:activeToken};
  const activeRole = activeSession?.playerRole || (activeSession?.hostToken ? 'host' : null);
  const boardState = useMemo(() => normalizeGameState(snapshot), [snapshot]);
  const chatMessages = useMemo(() => {
    const players = boardState?.players || [];
    return (snapshot?.chat || []).map(message => ({
      ...message,
      playerColor: players.find(player => player.id === message.playerId)?.color
    }));
  }, [snapshot?.chat, boardState?.players]);

  const updateStoredSession = useCallback(updater => {
    setSession(previous => {
      const requested = typeof updater === 'function' ? updater(previous) : updater;
      const rooms = { ...(previous?.rooms || {}) };
      if (!requested || (!requested.hostToken && !requested.playerToken)) {
        if (previous?.code) delete rooms[previous.code];
        const next = Object.keys(rooms).length
          ? { code: null, hostToken: null, playerToken: null, rooms }
          : null;
        saveSession(next);
        return next;
      }
      const { rooms: _requestedRooms, ...active } = requested;
      rooms[active.code] = active;
      const next = { ...active, rooms };
      saveSession(next);
      return next;
    });
  }, []);

  const clearRequestedRoom = useCallback(() => {
    setRequestedRoomCode('');
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);

  const handleAuthFailure = useCallback((token, activeTokenAtRequest) => {
    updateStoredSession(previous => {
      if (!previous) return null;
      const next = { ...previous };
      if (next.playerToken === token) {
        next.playerToken = null;
        next.playerRole = null;
        next.seatId = null;
        next.generation = 0;
      }
      if (next.hostToken === token) next.hostToken = null;
      return next.hostToken || next.playerToken ? next : null;
    });
    if (token === activeTokenAtRequest) {
      snapshotRef.current = null;
      setSnapshot(null);
    }
    hostSnapshotRef.current = null;
    setHostSnapshot(null);
    setError('This room session has expired. Join the room again to continue.');
  }, [updateStoredSession]);

  const observe = useCallback(async (code, token) => {
    return requestJson(`/api/rooms/${encodeURIComponent(code)}`, { token });
  }, []);

  useEffect(() => {
    let cancelled = false;
    requestJson('/api/providers')
      .then(response => {
        if (!cancelled) setProviders(Array.isArray(response.providers) ? response.providers : []);
      })
      .catch(() => {
        if (!cancelled) setProviders([]);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const code = activeSession?.code;
    const token = activeToken;
    if (!code || !token) {
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    let timer = null;
    let inFlight = false;

    const poll = async () => {
      if (cancelled) return;
      if (inFlight) {
        timer = window.setTimeout(poll, POLL_INTERVAL);
        return;
      }
      inFlight = true;
      try {
        const next = await observe(code, token);
        if (!cancelled) {
          acceptSnapshot(next, code, token);
          setLoading(false);
        }
      } catch (requestError) {
        if (!cancelled) {
          observationBoundary.current.interrupt();
          setLoading(false);
          if (requestError.status === 401) {
            handleAuthFailure(token, token);
          } else {
            connectionError.current = requestError.message;
            setError(requestError.message);
          }
        }
      } finally {
        inFlight = false;
        if (!cancelled) timer = window.setTimeout(poll, POLL_INTERVAL);
      }
    };

    observationBoundary.current.interrupt();
    setLoading(true);
    poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [activeSession?.code, activeToken, handleAuthFailure, observe, acceptSnapshot]);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  const addNotification = useCallback(message => {
    const id = `${Date.now()}-${Math.random()}`;
    setNotifications(previous => [...previous, { id, message }]);
    window.setTimeout(() => {
      setNotifications(previous => previous.filter(notification => notification.id !== id));
    }, 4000);
  }, []);

  const handleCreateRoom = useCallback(async ({ name, seatCount, seats, hostKey }) => {
    setBusy(true);
    setError(null);
    try {
      const response = await requestJson('/api/rooms', {
        method: 'POST',
        body: { name, seatCount, seats },
        headers: hostKey ? { 'X-Host-Key': hostKey } : undefined
      });
      const token = getToken(response);
      const code = getCode(response);
      if (!token || !code) throw new Error('The room service returned an incomplete room session.');
      updateStoredSession({
        code,
        hostToken: token,
        playerToken: null,
        playerRole: null,
        seatId: null,
        generation: 0,
        displayName: name
      });
      snapshotRef.current = null;
      hostSnapshotRef.current = null;
      setSnapshot(null);
      setHostSnapshot(null);
      clearRequestedRoom();
      addNotification(`Room ${code} created.`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }, [addNotification, updateStoredSession]);

  const handleJoinRoom = useCallback(async ({ code, name, role, seatId }) => {
    setBusy(true);
    setError(null);
    try {
      const response = await requestJson(`/api/rooms/${encodeURIComponent(code)}/join`, {
        method: 'POST',
        body: { name, role, ...(seatId ? { seatId } : {}) }
      });
      const token = getToken(response);
      const normalizedCode = getCode(response, code);
      if (!token || !normalizedCode) throw new Error('The room service returned an incomplete join session.');
      const sameRoom = session?.code === normalizedCode;
      updateStoredSession({
        code: normalizedCode,
        hostToken: sameRoom ? session?.hostToken || null : null,
        playerToken: token,
        playerRole: role,
        seatId: response.seatId || null,
        generation: Number.isInteger(response.generation) ? response.generation : 0,
        displayName: name
      });
      snapshotRef.current = null;
      hostSnapshotRef.current = null;
      setSnapshot(null);
      setHostSnapshot(null);
      clearRequestedRoom();
      addNotification(role === 'spectator' ? 'Joined as spectator.' : 'Joined the room.');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }, [addNotification, clearRequestedRoom, session, updateStoredSession]);

  const refreshActive = useCallback(async (code = activeSession?.code, token = activeToken) => {
    if (!code || !token) return null;
    try {
      const next = await observe(code, token);
      acceptSnapshot(next, code, token);
      setLoading(false);
      return next;
    } catch (requestError) {
      if (observationContext.current?.code !== code || observationContext.current?.token !== token) return null;
      observationBoundary.current.interrupt();
      if (requestError.status === 401) handleAuthFailure(token, activeToken);
      else { connectionError.current = requestError.message; setError(requestError.message); }
      return null;
    }
  }, [activeSession?.code, activeToken, handleAuthFailure, observe, acceptSnapshot]);

  const issueCommand = useCallback(async (type, payload = {}, { asHost = false } = {}) => {
    const currentSession = activeSession;
    const code = currentSession?.code;
    const token = asHost ? currentSession?.hostToken : currentSession?.playerToken || currentSession?.hostToken;
    if (!code || !token) return { success: false, error: 'Room session is unavailable.' };

    setBusy(true);
    setError(null);
    try {
      let source = asHost ? hostSnapshotRef.current : snapshotRef.current;
      if (asHost || !source || type === 'leave') {
        source = await observe(code, token);
        if (asHost) {
          hostSnapshotRef.current = source;
          setHostSnapshot(source);
        }
      }
      if (!source) return { success: false, error: 'Room state is unavailable.' };

      commandSequence.current += 1;
      const response = await requestJson(`/api/rooms/${encodeURIComponent(code)}/commands`, {
        method: 'POST',
        token,
        body: {
          requestId: `${makeRequestId()}-${commandSequence.current}`,
          revision: source.revision,
          generation: source.generation || 0,
          type,
          payload
        }
      });

      await refreshActive(code, activeToken);
      if (asHost) {
        hostSnapshotRef.current = hostSnapshotRef.current
          ? { ...hostSnapshotRef.current, revision: response.revision }
          : hostSnapshotRef.current;
        setHostSnapshot(previous => previous ? { ...previous, revision: response.revision } : previous);
      }
      return response;
    } catch (requestError) {
      if (requestError.status === 401) {
        handleAuthFailure(token, activeToken);
      } else if (requestError.status === 409) {
        await refreshActive(code, activeToken);
      }
      setError(requestError.message);
      return { success: false, error: requestError.message, statusCode: requestError.status };
    } finally {
      setBusy(false);
    }
  }, [activeSession, activeToken, handleAuthFailure, hostSnapshot, observe, refreshActive, session, snapshot]);

  useEffect(() => {
    adapter.configure({
      snapshot,
      gameState: boardState,
      seatId: activeSession?.seatId || null,
      sendCommand: issueCommand
    });
  }, [activeSession?.seatId, adapter, boardState, issueCommand, snapshot]);

  const handleHostCommand = useCallback((type, payload = {}) => {
    return issueCommand(type, payload, { asHost: true });
  }, [issueCommand]);

  const handleReady = useCallback(() => issueCommand('ready'), [issueCommand]);

  const handleResumeRoom = useCallback(code => {
    const saved = session?.rooms?.[code];
    if (!saved) return;
    updateStoredSession(saved);
    setSnapshot(null);
    setHostSnapshot(null);
    clearRequestedRoom();
    setError(null);
  }, [clearRequestedRoom, session?.rooms, updateStoredSession]);

  const handleLeaveRoom = useCallback(async () => {
    const currentSession = activeSession;
    if (currentSession?.playerToken) {
      const result = await issueCommand('leave', {}, { asHost: false });
      if (!result.success && ![401, 410].includes(result.statusCode)) return;
    }

    setSession(previous => {
      const rooms = { ...(previous?.rooms || {}) };
      if (currentSession?.hostToken) {
        rooms[currentSession.code] = {
          code: currentSession.code, hostToken: currentSession.hostToken,
          displayName: currentSession.displayName, playerToken: null,
          playerRole: null, seatId: null, generation: 0
        };
      } else if (currentSession?.code) delete rooms[currentSession.code];
      const next = Object.keys(rooms).length
        ? { code: null, hostToken: null, playerToken: null, rooms }
        : null;
      saveSession(next);
      return next;
    });
    clearRequestedRoom();
    snapshotRef.current = null;
    hostSnapshotRef.current = null;
    setSnapshot(null);
    setHostSnapshot(null);
    setError(null);
  }, [activeSession, clearRequestedRoom, issueCommand]);

  const hostControls = activeSession?.hostToken && boardState && boardState.phase !== 'finished' ? (
    <HostToolbar
      code={snapshot?.code}
      paused={Boolean(snapshot?.paused)}
      busy={busy}
      onCommand={handleHostCommand}
      slots={snapshot?.slots || []}
      providers={providers}
      phase={boardState.phase}
    />
  ) : null;

  const vacantHumanSlots = useMemo(
    () => (snapshot?.slots || []).filter(slot => slot.kind === 'human' && !slot.occupied),
    [snapshot?.slots]
  );
  const canClaimSeat = Boolean(
    boardState && boardState.phase !== 'finished'
      && activeSession?.code
      && !activeSession.seatId
      && (activeRole === 'host' || activeRole === 'spectator')
      && vacantHumanSlots.length
  );
  const liveClaimSeatForm = canClaimSeat ? (
    <LiveClaimSeatForm
      code={snapshot?.code || activeSession.code}
      defaultName={activeSession.displayName || ''}
      vacantHumanSlots={vacantHumanSlots}
      busy={busy}
      onClaim={handleJoinRoom}
    />
  ) : null;

  const tradePanel = useCallback((onClose, mode) => (
    <RoomTradePanel
      mode={mode}
      snapshot={snapshot}
      gameState={boardState}
      seatId={activeSession?.seatId || null}
      onCommand={issueCommand}
      onClose={onClose}
      addNotification={addNotification}
    />
  ), [activeSession?.seatId, addNotification, boardState, issueCommand, snapshot]);

  if (!boardState) {
    return (
      <>
        <RoomLobby
          snapshot={snapshot}
          session={session}
          loading={loading}
          busy={busy}
          error={error}
          providers={providers}
          savedRooms={Object.keys(session?.rooms || {}).filter(code => code !== activeSession?.code)}
          onCreateRoom={handleCreateRoom}
          onJoinRoom={handleJoinRoom}
          onHostCommand={handleHostCommand}
          onReady={handleReady}
          onLeaveRoom={handleLeaveRoom}
          onResumeRoom={handleResumeRoom}
          onCopyInvite={() => addNotification('Invite link copied.')}
        />
        {createPortal(
          <div className="notifications" aria-live="polite">
            {notifications.map(notification => <div key={notification.id} className="notification fade-in">{notification.message}</div>)}
          </div>,
          document.body
        )}
      </>
    );
  }

  return (
    <>
      <div className="app room-app">
        <div className="room-session-bar">
          <div className="room-session-status">
            <strong>{snapshot?.code}</strong>
            <span>{activeRole === 'spectator' || activeRole === 'host' ? 'Spectator view' : 'Human player'}</span>
            {snapshot?.paused && <span>Paused by host</span>}
          </div>
          <RoomShare code={snapshot?.code} replayId={snapshot?.replayId} ended={boardState.phase === 'finished'}/>
          <button type="button" className="room-link-button" onClick={handleLeaveRoom}>Leave room</button>
          {snapshot?.replayId && <a className="room-link-button" href={`/replay/${encodeURIComponent(snapshot.replayId)}`}>View replay</a>}
        </div>
        {error && <div className="room-error room-live-error" role="alert">{error}</div>}
        {boardState.phase === 'finished' && snapshot?.replayId && <section className="room-postgame"><div><h2>{boardState.winner ? `${boardState.players.find(player=>player.id===boardState.winner)?.name || 'A player'} won` : 'Game ended'}</h2><p>{snapshot.closeReason==='idle'?'This room closed after four hours without activity. ':' '}The recording is saved. Anyone with its replay link can view all hands.</p></div><a className="room-primary-button" href={`/replay/${encodeURIComponent(snapshot.replayId)}`}>Watch replay</a></section>}
        {hostControls}
        {liveClaimSeatForm}
        <GameBoard
          key={`${snapshot?.code}:${activeSession?.seatId || 'spectator'}:${snapshot?.generation ?? 0}`}
          presentationKey={`${snapshot?.code}:${snapshot?.generation ?? 0}:${snapshot?.controlEpoch ?? 0}:${presentationEpoch}`}
          socket={adapter}
          gameState={boardState}
          playerId={session?.seatId || null}
          gameCode={snapshot?.code}
          replayId={snapshot?.replayId}
          readOnlyChat={boardState.phase === 'finished'}
          chatMessages={chatMessages}
          onLeaveGame={handleLeaveRoom}
          addNotification={addNotification}
          legalActions={snapshot?.legalActions || []}
          events={snapshot?.events || []}
          rollEvent={snapshot?.rollEvent || null}
          slots={snapshot?.slots || []}
          cardEvents={snapshot?.cardEvents || []}
          robberPick={snapshot?.robberPick || null}
          paused={Boolean(snapshot?.paused)}
          tradePanel={tradePanel}
        />
      </div>
      {createPortal(
        <div className="notifications" aria-live="polite">
          {notifications.map(notification => <div key={notification.id} className="notification fade-in">{notification.message}</div>)}
        </div>,
        document.body
      )}
    </>
  );
}

function App() {
  const path = window.location.pathname;
  const goHome = () => window.location.assign('/');
  const watch=/^\/watch\/([A-Fa-f0-9]{8})\/?$/.exec(path);
  if(watch)return <WatchPage code={watch[1].toUpperCase()}/>;
  if (path === '/replays' || path === '/replays/') {
    return <ReplayArchive onBack={goHome} onOpen={id => window.location.assign(`/replay/${encodeURIComponent(id)}`)} />;
  }
  const match = /^\/replay\/([A-Za-z0-9_-]+)\/?$/.exec(path);
  if (match) {
    return <ReplayPage replayId={match[1]} onBack={goHome} getToken={roomCode => readStoredSession()?.rooms?.[roomCode]?.playerToken || null} />;
  }
  return <LiveApp />;
}

export default App;
