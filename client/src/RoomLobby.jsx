import { useEffect, useMemo, useState } from 'react';
import './room.css';

function getInviteLink(code) {
  if (!code || typeof window === 'undefined') return '';
  return `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(code)}`;
}

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
  onCopyInvite,
  onResumeRoom
}) {
  const [mode, setMode] = useState('choose');
  const [name, setName] = useState('');
  const [gameCode, setGameCode] = useState('');
  const [role, setRole] = useState('human');
  const [seatCount, setSeatCount] = useState('4');
  const [hostKey, setHostKey] = useState('');
  const [seatDrafts, setSeatDrafts] = useState({});
  const [claimName, setClaimName] = useState(session?.displayName || '');
  const [claimSeatId, setClaimSeatId] = useState('');
  const [copyLabel, setCopyLabel] = useState('Copy invite link');

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
  const inviteLink = getInviteLink(code);

  useEffect(() => {
    if (!snapshot?.slots) return;
    setSeatDrafts(previous => {
      const next = { ...previous };
      snapshot.slots.forEach(slot => {
        if (!next[slot.id]) {
          next[slot.id] = {
            kind: slot.kind,
            provider: slot.provider || providers[0]?.id || '',
            model: slot.model || ''
          };
        }
      });
      return next;
    });
  }, [providers, snapshot?.slots]);

  useEffect(() => {
    const queryCode = new URLSearchParams(window.location.search).get('room');
    if (queryCode && !gameCode) setGameCode(queryCode.toUpperCase());
  }, [gameCode]);

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
      model: slot.model || ''
    };
    onHostCommand('configureSeat', {
      seatId: slot.id,
      kind: draft.kind,
      ...(draft.kind === 'ai'
        ? { provider: draft.provider || providers[0]?.id, model: draft.model.trim() || undefined }
        : {})
    });
  };

  const copyInvite = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopyLabel('Copied');
      onCopyInvite?.();
      window.setTimeout(() => setCopyLabel('Copy invite link'), 1600);
    } catch {
      setCopyLabel('Copy unavailable');
      window.setTimeout(() => setCopyLabel('Copy invite link'), 2200);
    }
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
                Invite players, choose your seats, and get ready to play.
              </p>
            </div>
            <div className="room-code-block">
              <span className="room-label">Room code</span>
              <strong>{code}</strong>
              <button type="button" className="room-secondary-button" onClick={copyInvite}>
                {copyLabel}
              </button>
            </div>
          </header>

          {error && <div className="room-error" role="alert">{error}</div>}

          <section className="room-section" aria-labelledby="room-seats-heading">
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
                  model: slot.model || ''
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

          <footer className="room-footer">
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
            <h1>CATAN</h1>
            <p className="room-subtitle">Play Catan with friends and AI players.</p>
          </div>
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
            <label>
              Operator key
              <input
                type="password"
                value={hostKey}
                onChange={event => setHostKey(event.target.value)}
                placeholder="Required by the room host"
                autoComplete="off"
              />
              <span className="room-field-help">Used only for this request and never included in the invite link.</span>
            </label>
            <button type="submit" className="room-primary-button" disabled={busy}>
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
            <button type="submit" className="room-primary-button" disabled={busy}>
              {busy ? 'Joining…' : 'Join room'}
            </button>
          </form>
        )}

        <footer className="room-home-footer">
          First to 10 victory points wins. Standard rooms support 3 or 4 seats.
        </footer>
      </div>
    </main>
  );
}

export default RoomLobby;
