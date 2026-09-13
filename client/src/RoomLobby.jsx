import {PresentationControls} from './presentation/GamePresentation';
import {AiControls, ChatModelFields, AiStatus} from './components/AiControls';
import { useEffect, useMemo, useState } from 'react';
import './room.css';
import RoomShare, {AgentInstructions, EndRoomControl} from './sharing/RoomShare';

function RoomLobby({
  snapshot,
  session,
  providers = [],
  loading = false,
  busy = false,
  error,
  savedRooms = [],
  onCreateRoom,
  onJoinRoom,
  onHostCommand,
  onReady,
  onLeaveRoom,
  onResumeRoom
}) {
  const [mode, setMode] = useState(() => new URLSearchParams(window.location.search).has('room') ? 'join' : 'choose');
  const [name, setName] = useState('');
  const [gameCode, setGameCode] = useState(() => new URLSearchParams(window.location.search).get('room')?.toUpperCase() || '');
  const [role, setRole] = useState('human');
  const [seatCount, setSeatCount] = useState('4');
  const [hostKey, setHostKey] = useState('');
  const [seatDrafts, setSeatDrafts] = useState({});
  const [claimName, setClaimName] = useState(session?.displayName || '');
  const [claimSeatId, setClaimSeatId] = useState('');
  const [site, setSite] = useState(null);
  const [invitation, setInvitation] = useState(null);
  const [inviteError, setInviteError] = useState('');

  const code = snapshot?.code || session?.code || '';
  const slots = snapshot?.slots || [];
  const isHost = Boolean(session?.hostToken);
  const activeRole = session?.playerRole || snapshot?.role || null;
  const activeSeat = useMemo(
    () => slots.find(slot => slot.id === session?.seatId) || null,
    [slots, session?.seatId]
  );
  const allReady = slots.length > 0 && slots.every(slot => slot.occupied && slot.ready);
  const vacantHumanSlots = slots.filter(slot => slot.kind === 'human' && !slot.occupied);
  const ended = ['won', 'ended', 'closed'].includes(snapshot?.status);
  const inviteEnded = ['won', 'ended', 'closed'].includes(invitation?.status);

  useEffect(() => {setClaimName(session?.displayName || '');}, [session?.code, session?.displayName]);

  useEffect(() => {
    if (!snapshot?.slots) return;
    setSeatDrafts(previous => {
      const next = { ...previous };
      snapshot.slots.forEach(slot => {
        if (!next[slot.id]) {
          next[slot.id] = {
            kind: slot.kind,
            provider: slot.provider || providers[0]?.id || '',
            model: slot.model || '',
          chatEnabled: slot.chatEnabled !== false, chatModel: slot.chatModel || '', chatReasoning: slot.chatReasoning || ''
          };
        }
      });
      return next;
    });
  }, [providers, snapshot?.slots]);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/site', {signal: controller.signal}).then(response => response.json()).then(result => {
      if (result.success) setSite(result);
    }).catch(() => {});
    return () => controller.abort();
  }, [mode, snapshot?.code]);

  useEffect(() => {
    setInvitation(null); setInviteError('');
    if (snapshot || !/^[A-F0-9]{8}$/.test(gameCode)) return;
    const controller = new AbortController();
    fetch(`/api/rooms/${gameCode}/invitation`, {signal: controller.signal}).then(async response => {
      const result = await response.json();
      if (!response.ok) throw Error(result.error || 'Room unavailable');
      setInvitation(result);
    }).catch(error => {if (error.name !== 'AbortError') setInviteError(error.message);});
    return () => controller.abort();
  }, [gameCode, snapshot?.code]);

  const submitCreate = async event => {
    event.preventDefault();
    if (!name.trim()) return;
    await onCreateRoom({
      name: name.trim(),
      seatCount: Number(seatCount),
      seats: Array.from({ length: Number(seatCount) }, () => ({ kind: 'human' })),
      hostKey: hostKey.trim()
    });
  };

  const submitJoin = async event => {
    event.preventDefault();
    if (!name.trim() || !gameCode.trim()) return;
    await onJoinRoom({
      code: gameCode.trim().toUpperCase(),
      name: name.trim(),
      role
    });
  };

  const submitClaim = async event => {
    event.preventDefault();
    const selectedSeatId = vacantHumanSlots.some(slot => slot.id === claimSeatId)
      ? claimSeatId
      : vacantHumanSlots[0]?.id;
    if (!claimName.trim() || !selectedSeatId) return;
    await onJoinRoom({
      code,
      name: claimName.trim(),
      role: 'human',
      seatId: selectedSeatId
    });
  };

  const updateSeatDraft = (seatId, field, value) => {
    setSeatDrafts(previous => ({
      ...previous,
      [seatId]: { ...previous[seatId], [field]: value }
    }));
  };

  const configureSeat = slot => {
    const draft = seatDrafts[slot.id] || {
      kind: slot.kind,
      provider: slot.provider || providers[0]?.id || '',
      model: slot.model || '',
          chatEnabled: slot.chatEnabled !== false, chatModel: slot.chatModel || '', chatReasoning: slot.chatReasoning || ''
    };
    onHostCommand('configureSeat', {
      seatId: slot.id,
      kind: draft.kind,
      ...(draft.kind === 'ai'
        ? { provider: draft.provider || providers[0]?.id, model: draft.model.trim() || undefined, chatEnabled: draft.provider !== 'mcp' && draft.chatEnabled !== false, chatModel: draft.chatModel?.trim() || null, chatReasoning: draft.chatReasoning || null }
        : {})
    });
  };

  if (!snapshot && session?.code && loading) {
    return (
      <main className="room-lobby room-lobby-loading" aria-live="polite">
        <div className="room-loading-panel">
          <p className="room-kicker">Catan room</p>
          <h1>Restoring room {session.code}</h1>
          <p>Checking the saved room session.</p>
        </div>
      </main>
    );
  }

  if (snapshot) {
    return (
      <main className="room-lobby room-lobby-room">
        <div className="room-shell">
          <header className="room-header">
            <div>
              <p className="room-kicker">Room lobby</p>
              <h1>{snapshot.name || 'Catan room'}</h1>
              <p className="room-subtitle">
                {ended ? (snapshot.closeReason === 'idle' ? 'Closed after four hours without activity.' : 'This room has ended.') : 'Invite players, choose your seats, and get ready to play.'}
              </p>
              {ended && snapshot.replayId && <a className="room-link-button" href={`/replay/${encodeURIComponent(snapshot.replayId)}`}>View recording</a>}
            </div>
            <div className="room-code-block">
              <PresentationControls/>
              <span className="room-label">Room code</span>
              <strong>{code}</strong>
              <RoomShare code={code} replayId={snapshot.replayId} ended={ended}/>
            </div>
          </header>

          {error && <div className="room-error" role="alert">{error}</div>}

          {!ended && <><section className="room-section" aria-labelledby="room-seats-heading">
            <div className="room-section-heading">
              <div>
                <h2 id="room-seats-heading">Seats</h2>
                <p>{slots.length} seats must be occupied and ready before the host starts.</p>
              </div>
            </div>

            <div className="room-seat-list">
              {slots.map((slot, index) => {
                const draft = seatDrafts[slot.id] || {
                  kind: slot.kind,
                  provider: slot.provider || providers[0]?.id || '',
                  model: slot.model || '',
          chatEnabled: slot.chatEnabled !== false, chatModel: slot.chatModel || '', chatReasoning: slot.chatReasoning || ''
                };
                const providerName = providers.find(provider => provider.id === slot.provider)?.name || slot.provider;
                return (
                  <article className="room-seat" key={slot.id}>
                    <div className="room-seat-main">
                      <div>
                        <h3>{slot.name || `Seat ${index + 1}`}</h3>
                        <p className="room-seat-meta">
                          {slot.kind === 'ai' ? `${providerName || 'AI'} controller` : 'Human controller'}
                          {slot.model ? ` · ${slot.model}` : ''}
                        </p>
                      </div>
                      <div className="room-seat-status" aria-label={`${slot.name} status`}>
                        <span>{slot.occupied ? 'Occupied' : 'Vacant'}</span>
                        <span>{slot.connected ? 'Connected' : 'Waiting'}</span>
                        <AiStatus slot={slot}/>
                        <span>{slot.ready ? 'Ready' : 'Not ready'}</span>
                      </div>
                    </div>

                    {isHost && !slot.occupied && (
                      <div className="room-seat-config">
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
                                placeholder="Configured by the controller"
                                maxLength={40}
                              />
                            </label>
                      {draft.provider !== 'mcp' && <ChatModelFields draft={draft} onChange={(field,value)=>updateSeatDraft(slot.id,field,value)}/>}
                          </>
                        )}
                        <button
                          type="button"
                          className="room-secondary-button"
                          onClick={() => configureSeat(slot)}
                          disabled={busy || (draft.kind === 'ai' && !providers.length)}
                        >
                          Save seat
                        </button>
                      </div>
                    )}

                    {slot.kind === 'ai' && !slot.occupied && <AgentInstructions key={`${slot.id}:${slot.provider}:${slot.model}`} code={code} slot={slot}/>}
                    {isHost && slot.kind === 'ai' && <AiControls slot={slot} onCommand={onHostCommand} busy={busy} showStatus={false}/>}
                    {isHost && slot.occupied && (
                      <div className="room-seat-actions">
                        <button
                          type="button"
                          className="room-danger-button"
                          onClick={() => onHostCommand('removeController', { seatId: slot.id, kind: slot.kind })}
                          disabled={busy}
                        >
                          Remove controller
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>

          <section className="room-section room-lobby-actions" aria-labelledby="room-actions-heading">
            <div className="room-section-heading">
              <div>
                <h2 id="room-actions-heading">Ready to start</h2>
                <p>
                  {allReady
                    ? 'Every seat is ready.'
                    : 'Waiting for every controller to connect and mark the seat ready.'}
                </p>
              </div>
              {isHost && (
                <button
                  type="button"
                  className="room-primary-button"
                  onClick={() => onHostCommand('start')}
                  disabled={!allReady || busy}
                >
                  Start game
                </button>
              )}
            </div>

            {activeRole === 'human' && activeSeat && (
              <div className="room-ready-row">
                <div>
                  <strong>{activeSeat.name}</strong>
                  <p>{activeSeat.ready ? 'Your seat is ready for the host.' : 'Mark your seat ready when you are set.'}</p>
                </div>
                <button
                  type="button"
                  className="room-secondary-button"
                  onClick={onReady}
                  disabled={activeSeat.ready || busy}
                >
                  {activeSeat.ready ? 'Ready' : 'Mark ready'}
                </button>
              </div>
            )}

            {activeRole === 'spectator' && (
              <p className="room-muted">You are watching this room. A spectator cannot mark a seat ready.</p>
            )}

            {activeRole !== 'human' && vacantHumanSlots.length > 0 && (
              <form className="room-claim-form" onSubmit={submitClaim}>
                <div>
                  <h3>Claim a human seat</h3>
                  <p>Hosts and spectators can take an unoccupied human seat in this room.</p>
                </div>
                <label>
                  Name
                  <input
                    type="text"
                    value={claimName}
                    onChange={event => setClaimName(event.target.value)}
                    placeholder="Enter your name"
                    maxLength={40}
                    required
                  />
                </label>
                <label>
                  Seat
                  <select
                    value={claimSeatId || vacantHumanSlots[0]?.id || ''}
                    onChange={event => setClaimSeatId(event.target.value)}
                    required
                  >
                    {vacantHumanSlots.map((slot, index) => (
                      <option key={slot.id} value={slot.id}>{slot.name || `Seat ${index + 1}`}</option>
                    ))}
                  </select>
                </label>
                <button type="submit" className="room-primary-button" disabled={busy}>
                  {busy ? 'Claiming…' : 'Claim seat'}
                </button>
              </form>
            )}
          </section>

          </>}

          <footer className="room-footer">
            {isHost && !ended && <EndRoomControl label="Close room" onEnd={() => onHostCommand('closeRoom')} busy={busy}/>}
            <span>{isHost ? 'You are the host.' : 'You are connected to this room.'}</span>
            <button type="button" className="room-link-button" onClick={onLeaveRoom}>
              Leave room
            </button>
          </footer>
        </div>
      </main>
    );
  }

  return (
    <main className="room-lobby">
      <div className="room-shell room-home-shell">
        <header className="room-header room-home-header">
          <div>
            <h1>Catan Online</h1>
            <span className="room-brand-credit">by rlin</span>
            <p className="room-subtitle">Play Catan with friends and AI players.</p>
          </div>
          <div className="room-home-tools"><PresentationControls/></div>
        </header>

        {error && <div className="room-error" role="alert">{error}</div>}

        {mode === 'choose' && (
          <>
            <div className="room-choice-grid">
              <button type="button" className="room-choice" onClick={() => setMode('create')}>
                <strong>Create a room</strong>
                <span>Set the seat count and invite the table.</span>
              </button>
              <button type="button" className="room-choice" onClick={() => setMode('join')}>
                <strong>Join a room</strong>
                <span>Use a room code as a player or spectator.</span>
              </button>
            </div>
            {savedRooms.length > 0 && (
              <section className="room-saved-section" aria-labelledby="saved-rooms-heading">
                <h2 id="saved-rooms-heading">Saved host rooms</h2>
                <p>Resume a saved host session for one of your other rooms.</p>
                <div className="room-saved-list">
                  {savedRooms.map(savedCode => (
                    <button type="button" className="room-secondary-button" key={savedCode} onClick={() => onResumeRoom?.(savedCode)}>
                      Resume {savedCode}
                    </button>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {mode === 'create' && (
          <form className="room-form" onSubmit={submitCreate}>
            <div className="room-form-heading">
              <button type="button" className="room-link-button" onClick={() => setMode('choose')}>
                Back
              </button>
              <h2>Create a room</h2>
            </div>
            <label>
              Your name
              <input
                type="text"
                value={name}
                onChange={event => setName(event.target.value)}
                placeholder="Enter your name"
                maxLength={40}
                autoFocus
                required
              />
            </label>
            <label>
              Seats
              <select value={seatCount} onChange={event => setSeatCount(event.target.value)}>
                <option value="3">3 seats</option>
                <option value="4">4 seats</option>
              </select>
            </label>
            <p className="room-field-help">Rooms close after four hours without activity. Keep your host session in this browser to manage the room.</p>
            {site && !site.available && <p role="status">All {site.maxRooms} public rooms are in use. Try again after a room ends.</p>}
            <details className="room-operator-options"><summary>Operator override</summary><label>
              Operator key
              <input
                type="password"
                value={hostKey}
                onChange={event => setHostKey(event.target.value)}
                placeholder="Optional server operator key"
                autoComplete="off"
              />
              <span className="room-field-help">Optional. Server operators can create a room above the public limit.</span>
            </label></details>
            <button type="submit" className="room-primary-button" disabled={busy || (site?.available === 0 && !hostKey.trim())}>
              {busy ? 'Creating…' : 'Create room'}
            </button>
          </form>
        )}

        {mode === 'join' && (
          <form className="room-form" onSubmit={submitJoin}>
            <div className="room-form-heading">
              <button type="button" className="room-link-button" onClick={() => setMode('choose')}>
                Back
              </button>
              <h2>Join a room</h2>
            </div>
            <label>
              Room code
              <input
                type="text"
                value={gameCode}
                onChange={event => setGameCode(event.target.value.toUpperCase())}
                placeholder="Enter the room code"
                maxLength={8}
                autoFocus
                required
              />
            </label>
            {inviteError && <p role="status">{inviteError}</p>}
            {invitation && <div className="room-invite-preview"><strong>{invitation.name}</strong><p>{inviteEnded ? 'This room has ended.' : `${invitation.slots.filter(slot => slot.kind === 'human' && !slot.occupied).length} human seats available`}</p>{inviteEnded && invitation.replayId ? <a href={`/replay/${invitation.replayId}`}>Watch replay</a> : <a href={`/watch/${gameCode}`}>Watch as a spectator</a>}</div>}

            <label>
              Your name
              <input
                type="text"
                value={name}
                onChange={event => setName(event.target.value)}
                placeholder="Enter your name"
                maxLength={40}
                required
              />
            </label>
            <label>
              Join as
              <select value={role} onChange={event => setRole(event.target.value)}>
                <option value="human">Human player</option>
                <option value="spectator">Spectator</option>
              </select>
            </label>
            <span className="room-field-help">
              AI controllers register through the configured provider and do not use this browser form.
            </span>
            <button type="submit" className="room-primary-button" disabled={busy || inviteEnded || Boolean(inviteError)}>
              {busy ? 'Joining…' : 'Join room'}
            </button>
          </form>
        )}

        <AgentInstructions/>
        <footer className="room-home-footer">
          First to 10 victory points wins. Standard rooms support 3 or 4 seats.
        </footer>
      </div>
    </main>
  );
}

export default RoomLobby;
