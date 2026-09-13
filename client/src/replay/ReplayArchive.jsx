import {PresentationControls} from '../presentation/GamePresentation';
import { useEffect, useRef, useState } from 'react';
import { formatDuration, formatReplayDate, isTerminalRecording, requestReplayJson, statusLabel } from './replayUtils';
import './ReplayPage.css';

const PAGE_SIZE = 12;

function ArchiveRow({ recording, onOpen, onDelete, deleting }) {
  const [copied, setCopied] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const players = recording.players || [];
  const winner = players.find(player => player.id === recording.winnerId);

  const copyLink = async () => {
    const relative = `/replay/${recording.id}`;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${relative}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return <li className="replay-archive-row">
    <button type="button" className="replay-archive-main" onClick={() => onOpen?.(recording.id)}>
      <span className="replay-archive-title"><strong>{recording.title || players.map(player => player.name).filter(Boolean).join(' vs ') || 'Recorded match'}</strong><small>{formatReplayDate(recording.startedAt)}</small></span>
      <span className="replay-archive-players">{players.length ? players.map(player => player.name).filter(Boolean).join(', ') : 'No players recorded'}</span>
      <span><b>{statusLabel(recording)}</b><small>{winner ? `${winner.name} won` : 'No winner'}</small></span>
      <span><b>{formatDuration(recording.elapsedMs)}</b><small>{Number(recording.lastSeq) || 0} events</small></span>
      <span className="replay-archive-flags">{recording.sample && <i>Sample</i>}{recording.partial && <i>Partial</i>}</span>
    </button>
    <div className="replay-archive-actions">
      <button type="button" className="replay-copy-button" onClick={copyLink}>{copied ? 'Copied' : 'Copy link'}</button>
      {isTerminalRecording(recording) && <button type="button" className="replay-delete-button" onClick={() => setConfirmingDelete(true)} disabled={deleting}>Delete</button>}
    </div>
    {confirmingDelete && <div className="replay-delete-confirm" role="alertdialog" aria-modal="false" aria-labelledby={`delete-${recording.id}`}>
      <p id={`delete-${recording.id}`}>Delete <strong>{recording.title || 'this recorded match'}</strong>? This removes its replay and export.</p>
      <div><button type="button" onClick={() => setConfirmingDelete(false)} disabled={deleting}>Cancel</button><button type="button" className="is-danger" onClick={() => onDelete(recording.id).then(deleted => { if (!deleted) return; setConfirmingDelete(false); })} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete recording'}</button></div>
    </div>}
  </li>;
}

export default function ReplayArchive({ onOpen, onBack }) {
  const [operatorKey, setOperatorKey] = useState('');
  const [authenticatedKey, setAuthenticatedKey] = useState('');
  const [recordings, setRecordings] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [error, setError] = useState('');
  const accessEpoch = useRef(0);
  const pendingLoad = useRef(null);

  const loadPage = async (key, nextPage) => {
    pendingLoad.current?.abort();
    const controller = new AbortController();
    pendingLoad.current = controller;
    const epoch = accessEpoch.current;
    setLoading(true);
    setError('');
    try {
      const data = await requestReplayJson(`/api/replays?offset=${nextPage * PAGE_SIZE}&limit=${PAGE_SIZE}`, { headers: { 'X-Host-Key': key }, signal: controller.signal });
      if (controller.signal.aborted || epoch !== accessEpoch.current) return;
      setAuthenticatedKey(key);
      setRecordings(Array.isArray(data.recordings) ? data.recordings : []);
      setTotal(Number(data.total) || 0);
      setPage(nextPage);
    } catch (loadError) {
      if (controller.signal.aborted || epoch !== accessEpoch.current) return;
      setRecordings([]);
      setTotal(0);
      if (!authenticatedKey) setAuthenticatedKey('');
      setError(loadError.status === 401 || loadError.status === 403 ? 'That operator key was not accepted.' : loadError.message);
    } finally {
      if (!controller.signal.aborted && epoch === accessEpoch.current) setLoading(false);
    }
  };

  const deleteRecording = async id => {
    const epoch = accessEpoch.current;
    setDeletingId(id);
    setError('');
    try {
      await requestReplayJson(`/api/replays/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'X-Host-Key': authenticatedKey } });
      if (epoch !== accessEpoch.current) return false;
      const nextPage = recordings.length === 1 && page > 0 ? page - 1 : page;
      await loadPage(authenticatedKey, nextPage);
      return true;
    } catch (deleteError) {
      if (epoch !== accessEpoch.current) return false;
      setError(deleteError.message || 'The recording could not be deleted.');
      return false;
    } finally {
      if (epoch === accessEpoch.current) setDeletingId('');
    }
  };

  useEffect(() => () => {
    accessEpoch.current++;
    pendingLoad.current?.abort();
  }, []);

  const lockArchive = () => {
    accessEpoch.current++;
    pendingLoad.current?.abort();
    setAuthenticatedKey(''); setOperatorKey(''); setRecordings([]); setTotal(0); setPage(0); setLoading(false); setDeletingId('');
  };

  if (!authenticatedKey) return <main className="replay-route replay-archive-route">
    <header className="replay-topbar"><PresentationControls/>
      <div className="replay-brand-row">{onBack && <button type="button" className="replay-back-button" onClick={onBack}>Back</button>}<span className="replay-wordmark">CATAN</span><span className="replay-mode">Match archive</span></div>
    </header>
    <section className="replay-key-panel">
      <div><h1>Open the match archive</h1><p>Enter the operator key to browse recorded matches. The key is kept only for this open archive view.</p></div>
      <form onSubmit={event => { event.preventDefault(); if (operatorKey.trim()) loadPage(operatorKey.trim(), 0); }}>
        <label htmlFor="replay-operator-key">Operator key</label>
        <div><input id="replay-operator-key" type="password" autoComplete="off" value={operatorKey} onChange={event => { setOperatorKey(event.target.value); setError(''); }} autoFocus /><button type="submit" className="replay-primary-button" disabled={loading || !operatorKey.trim()}>{loading ? 'Checking…' : 'Open archive'}</button></div>
        {error && <p className="replay-form-error" role="alert">{error}</p>}
      </form>
    </section>
  </main>;

  const first = total ? page * PAGE_SIZE + 1 : 0;
  const last = Math.min(total, (page + 1) * PAGE_SIZE);
  return <main className="replay-route replay-archive-route">
    <header className="replay-topbar"><PresentationControls/>
      <div className="replay-brand-row">{onBack && <button type="button" className="replay-back-button" onClick={onBack}>Back</button>}<span className="replay-wordmark">CATAN</span><span className="replay-mode">Match archive</span></div>
      <button type="button" className="replay-secondary-button" onClick={lockArchive}>Lock archive</button>
    </header>
    <section className="replay-archive-shell">
      <header><div><h1>Recorded matches</h1><p>{total ? `${total} matches retained until the host deletes them.` : 'No recorded matches yet.'}</p></div>{total > 0 && <span>Showing {first}–{last} of {total}</span>}</header>
      {error && <div className="replay-inline-error" role="status">{error}</div>}
      {loading ? <div className="replay-loading-inline" aria-busy="true">Loading matches…</div> : recordings.length ? <ol className="replay-archive-list">{recordings.map(recording => <ArchiveRow key={recording.id} recording={recording} onOpen={onOpen} onDelete={deleteRecording} deleting={deletingId === recording.id} />)}</ol> : <div className="replay-archive-empty"><strong>The archive is empty.</strong><span>Finished and incomplete recordings will appear here.</span></div>}
      {total > PAGE_SIZE && <nav className="replay-pagination" aria-label="Archive pages"><button type="button" onClick={() => loadPage(authenticatedKey, page - 1)} disabled={loading || page === 0}>Previous</button><span>Page {page + 1} of {Math.ceil(total / PAGE_SIZE)}</span><button type="button" onClick={() => loadPage(authenticatedKey, page + 1)} disabled={loading || last >= total}>Next</button></nav>}
    </section>
  </main>;
}
